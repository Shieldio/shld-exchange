# SHLD Exchange

Samostatná burzovní hra pro 3 hráče. Pouze virtuální peníze. Žádná vazba na produkční shieldio.cz.

- Každý začíná s 23 000 vKč, výchozí cena 100 vKč/SHLD.
- Společný constant-product AMM: 10 000 SHLD / 1 000 000 vKč, poplatek 0,3 %.
- BUY zvedá cenu, SELL ji snižuje. Žádné uměle generované obchody.
- Jeden SQLite Durable Object serializuje obchody, atomicky ukládá zůstatky i historii.
- WebSocket Hibernation přenáší změny okamžitě; žádný polling, cron, externí API ani frontendové závislosti.
- Graf posledních 200 obchodů, export celé historie, žebříček.
- HttpOnly cookie, validace na serveru, ochrana proti duplicitním objednávkám, 1% cenový limit a 1 obchod/s/hráč.

## Spuštění a nasazení

Vyžaduje Node.js 22+ a existující Cloudflare účet s Workers Free.

```sh
npm install
npm test
npx wrangler dev
npx wrangler login
npm run deploy
```

Konfigurace záměrně neobsahuje žádné `routes` ani vlastní doménu. Worker `shld-exchange` běží výhradně na své `workers.dev` adrese. `new_sqlite_classes` v migraci umožňuje Durable Objects v tarifu Free.

Cloudflare Workers Builds: připojit tento repozitář, build command `npm test`, deploy command `npx wrangler deploy`. Žádná další databáze, API klíč pro hru nebo placený tarif nejsou potřeba.

## Náklady

Zůstat na Workers Free, neaktivovat placený tarif. Cloudflare Free má kvóty sdílené celým účtem; při jejich překročení požadavky selžou místo účtování příplatku. Tento malý experiment bez časovačů je navržen pro tři hráče, ne veřejnou vysokou zátěž. Aktuální podmínky: https://developers.cloudflare.com/durable-objects/platform/pricing/

## Přístup hráčů

První tři přihlášení obsadí místa, další návštěvníci jsou diváci. Zadejte přezdívky ze tří vlastních prohlížečů. Soukromá cookie přiřazuje prohlížeč k hráči; po jejím smazání se přístup neobnoví. Obnova, administrace a reset jsou záměrně vynechány. Pro neveřejnou skupinku sdílejte URL pouze hráčům; kdo ji dostane před nimi, může obsadit místo.

Zůstatky a všechny obchody přetrvají restart Workeru i nové nasazení, dokud není odstraněn Durable Object nebo jeho data. Export historie provádějte průběžně; data nejsou zálohována do GitHubu. Ceny jsou v Kč pouze jako herní účetní jednotka, žádné skutečné obchody či výplaty.
