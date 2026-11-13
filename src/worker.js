import {INITIAL_CASH, INITIAL_UNITS, INITIAL_RESERVE, execute} from './market.js';
import {HTML} from './page.js';
const json = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default {
  async fetch(req,env) {
    const url=new URL(req.url);
    if(url.pathname==='/') return new Response(HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
    if(url.pathname==='/favicon.ico') return new Response(null,{status:204});
    if(!['/api/join','/api/state','/api/trade','/api/history','/api/live'].includes(url.pathname)) return json({error:'Nenalezeno'},404);
    const origin=req.headers.get('Origin');
    if(origin && origin!==url.origin) return json({error:'Cizí původ požadavku.'},403);
    if(req.method==='POST' && !req.headers.get('Content-Type')?.startsWith('application/json')) return json({error:'Vyžadován JSON.'},415);
    return env.EXCHANGE.getByName('shld-main-v1').fetch(req);
  }
};
export class Exchange {
  constructor(ctx,env) {
    this.ctx=ctx; this.sql=ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS market(id INTEGER PRIMARY KEY CHECK(id=1),units INTEGER NOT NULL,reserve INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS players(id INTEGER PRIMARY KEY, name TEXT NOT NULL, token TEXT UNIQUE NOT NULL,cash INTEGER NOT NULL,units INTEGER NOT NULL DEFAULT 0,last_trade INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT UNIQUE NOT NULL,player INTEGER NOT NULL,side TEXT NOT NULL,quantity INTEGER NOT NULL,total INTEGER NOT NULL,price REAL NOT NULL,ts INTEGER NOT NULL);`);
    this.sql.exec('INSERT OR IGNORE INTO market VALUES(1,?,?)',INITIAL_UNITS,INITIAL_RESERVE);
  }
  rows(q,...args){return this.sql.exec(q,...args).toArray();}
  state() {
    const market=this.rows('SELECT units,reserve FROM market WHERE id=1')[0];
    return {market,price:market.reserve/market.units/100,players:this.rows('SELECT id,name,cash,units FROM players ORDER BY id'),trades:this.rows('SELECT t.id,t.player,p.name,t.side,t.quantity,t.total,t.price,t.ts FROM trades t JOIN players p ON p.id=t.player ORDER BY t.id DESC LIMIT 200'),count:this.rows('SELECT COALESCE(MAX(id),0) AS n FROM trades')[0].n};
  }
  player(req){const token=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)shld=([a-f0-9]{64})(?:;|$)/)?.[1];return token?this.rows('SELECT * FROM players WHERE token=?',token)[0]:null;}
  broadcast(){const msg=JSON.stringify(this.state());for(const ws of this.ctx.getWebSockets())try{ws.send(msg);}catch{ws.close(1011,'Reconnect');}}
  async fetch(req) {
    try {
      const path=new URL(req.url).pathname;
      if(path==='/api/join' && req.method==='POST') {
        const existing=this.player(req); if(existing)return json({me:existing.id,...this.state()});
        const text=await req.text(); if(text.length>256)return json({error:'Příliš dlouhý požadavek.'},413);
        const body=JSON.parse(text); const name=String(body.name||'').trim().slice(0,24);
        if(!name)throw Error('Zadej přezdívku.');
        const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
        let id;
        this.ctx.storage.transactionSync(()=>{
          const players=this.rows('SELECT id FROM players'); if(players.length>=3)throw Error('Všechna tři místa jsou obsazená. Můžeš sledovat trh.');
          id=players.length+1;this.sql.exec('INSERT INTO players(id,name,token,cash) VALUES(?,?,?,?)',id,name,token,INITIAL_CASH);
        });
        this.broadcast();
        return new Response(JSON.stringify({me:id,...this.state()}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':`shld=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=31536000`}});
      }
      const me=this.player(req);
      if(path==='/api/state' && req.method==='GET')return json({me:me?.id||null,...this.state()});
      if(path==='/api/history' && req.method==='GET'){
        const after=Number(new URL(req.url).searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)throw Error('Neplatná stránka.');
        return json(this.rows('SELECT t.id,t.player,p.name,t.side,t.quantity,t.total,t.price,t.ts FROM trades t JOIN players p ON p.id=t.player WHERE t.id>? ORDER BY t.id LIMIT 500',after));
      }
      if(path==='/api/live' && req.method==='GET') {
        if(req.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'WebSocket required'},426);
        if(this.ctx.getWebSockets().length>=12)return json({error:'Příliš mnoho spojení.'},429);
        const [client,server]=Object.values(new WebSocketPair());this.ctx.acceptWebSocket(server);server.send(JSON.stringify(this.state()));return new Response(null,{status:101,webSocket:client});
      }
      if(path==='/api/trade' && req.method==='POST'){
        if(!me)return json({error:'Nejdřív se připoj jako hráč.'},401);
        const text=await req.text();if(text.length>512)return json({error:'Příliš dlouhý požadavek.'},413);
        const b=JSON.parse(text);if(typeof b.requestId!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(b.requestId))throw Error('Neplatné ID obchodu.');
        this.ctx.storage.transactionSync(()=>{
          const duplicate=this.rows('SELECT player FROM trades WHERE request_id=?',b.requestId)[0];
          if(duplicate){if(duplicate.player!==me.id)throw Error('Neplatné ID.');return;}
          const p=this.rows('SELECT * FROM players WHERE id=?',me.id)[0];const now=Date.now();if(now-p.last_trade<1000)throw Error('Maximálně jeden obchod za sekundu.');
          const m=this.rows('SELECT units,reserve FROM market WHERE id=1')[0];const r=execute(m,p,b.side,b.quantity,b.limit);
          this.sql.exec('UPDATE market SET units=?,reserve=? WHERE id=1',r.market.units,r.market.reserve);
          this.sql.exec('UPDATE players SET cash=?,units=?,last_trade=? WHERE id=?',r.player.cash,r.player.units,now,me.id);
          this.sql.exec('INSERT INTO trades(request_id,player,side,quantity,total,price,ts) VALUES(?,?,?,?,?,?,?)',b.requestId,me.id,b.side,b.quantity,r.total,r.market.reserve/r.market.units/100,now);
        });
        this.broadcast();return json({me:me.id,...this.state()});
      }
      return json({error:'Metoda není povolena.'},405);
    } catch(e){return json({error:e instanceof SyntaxError?'Neplatný JSON.':e.message},400);}
  }
  webSocketMessage(ws){ws.close(1008,'Read-only stream');}
  webSocketClose(ws,code){ws.close(code===1005?1000:code);}
  webSocketError(ws){ws.close(1011,'Reconnect');}
}
