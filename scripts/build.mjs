import { execFileSync } from "node:child_process";
import { build } from "esbuild";
execFileSync(
  "node",
  [
    "node_modules/tailwindcss/lib/cli.js",
    "-i",
    "assets/input.css",
    "-o",
    "assets/tailwind.css",
    "--minify",
  ],
  { stdio: "inherit" },
);
for (const name of ["tickets", "admin-community", "gate"])
  await build({
    entryPoints: [`assets/${name}.js`],
    bundle: true,
    minify: true,
    format: "esm",
    outfile: `assets/${name}.bundle.js`,
  });
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
mkdirSync("assets/vendor", { recursive: true });
cpSync("node_modules/@fortawesome/fontawesome-free/LICENSE.txt", "assets/vendor/fontawesome-LICENSE.txt");
cpSync(
  "node_modules/@fortawesome/fontawesome-free/css/all.min.css",
  "assets/vendor/fontawesome.css",
);
cpSync(
  "node_modules/@fortawesome/fontawesome-free/webfonts",
  "assets/webfonts",
  { recursive: true },
);
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
for (const file of readdirSync("."))
  if (
    /\.(html|css|js|png|PNG|jpg|JPG|ico|xml|txt)$/.test(file) &&
    !["tailwind.config.cjs"].includes(file)
  )
    cpSync(file, `dist/${file}`);
for (const folder of ["assets", "icons"])
  cpSync(folder, `dist/${folder}`, { recursive: true });
