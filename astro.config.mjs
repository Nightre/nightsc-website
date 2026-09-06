// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

import cloudflare from "@astrojs/cloudflare";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

// https://astro.build/config
export default defineConfig({
	site: "https://example.com",
	devToolbar: {
		enabled: false,
	},
	integrations: [mdx(), sitemap()],
	vite: {
		plugins: [
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
