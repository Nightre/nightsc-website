// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

export default defineConfig({
	site: "https://example.com",
	devToolbar: {
		enabled: false,
	},
	integrations: [mdx(), sitemap()],
	vite: {
		plugins: [
			tailwindcss(),
			paraglideVitePlugin({
				project: "./project.inlang",
				outdir: "./src/paraglide",
				emitTsDeclarations: true,
				strategy: ["localStorage", "preferredLanguage", "baseLocale"],
			}),
		],
	},
	adapter: cloudflare({
		platformProxy: {
			enabled: true,
		},
	}),
});
