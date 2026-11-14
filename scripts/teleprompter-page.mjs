// After vite build: dist/teleprompter/index.html, the same app with its own title, description and a few
// plain lines for search engines, so editor.postbarrel.com/teleprompter/ can be found as a free teleprompter.
// The app sees the /teleprompter address and opens straight on the teleprompter (OPEN_ON_TELEPROMPTER in App.tsx).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const title = "Free online teleprompter | Postbarrel";
const description =
  "A free teleprompter that runs in your browser. Paste your script, set the speed and text size, and read it while you record with your camera. No sign-up, and your videos stay on your computer.";
const words = `
    <noscript>
      <h1>Free online teleprompter</h1>
      <p>Paste your script, set the scroll speed and text size, and read it while you record with your camera.</p>
      <p>It runs in your browser with no sign-up, and your videos stay on your computer.</p>
      <p>Part of Postbarrel Vid Editor, a free video editor. Turn on JavaScript to use it.</p>
    </noscript>`;

let page = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
page = page.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${description}" />`);
page = page.replace('<link rel="icon"', '<link rel="canonical" href="https://editor.postbarrel.com/teleprompter/" />\n    <link rel="icon"');
page = page.replace('<div id="root"></div>', `<div id="root"></div>${words}`);
for (const must of [title, description, "canonical", "<noscript>"]) if (!page.includes(must)) throw new Error(`teleprompter page: ${must} missing`);

mkdirSync("dist/teleprompter", { recursive: true });
writeFileSync("dist/teleprompter/index.html", page);
console.log("teleprompter page: dist/teleprompter/index.html");
