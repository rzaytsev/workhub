import { defineConfig } from "vite";

export default defineConfig({
  root: "src/app",
  plugins: [
    {
      name: "inline-mcp-app",
      enforce: "post",
      generateBundle(_options, bundle) {
        const html = bundle["index.html"];
        if (!html || html.type !== "asset") throw Error("Missing app HTML.");
        let source = String(html.source);
        for (const [file, asset] of Object.entries(bundle)) {
          if (asset.type === "chunk") {
            source = source.replace(
              new RegExp(`<script[^>]*src="/?${file}"[^>]*></script>`),
              () =>
                `<script type="module">${asset.code.replaceAll("</script", "<\\/script")}</script>`,
            );
            delete bundle[file];
          } else if (file.endsWith(".css")) {
            source = source.replace(
              new RegExp(`<link[^>]*href="/?${file}"[^>]*>`),
              () => `<style>${asset.source}</style>`,
            );
            delete bundle[file];
          }
        }
        html.source = source;
      },
    },
  ],
  build: {
    outDir: "../../dist/app",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: Infinity,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
