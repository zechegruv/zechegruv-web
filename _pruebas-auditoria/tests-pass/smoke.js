const { start } = require("./web-harness");
(async () => { const h = await start(); const p = await h.page(); await p.goto(h.base + "/pass/orden/?t=" + "a".repeat(64)); await p.waitForTimeout(500); console.log(await p.title(), p.errors); await h.close(); })();
