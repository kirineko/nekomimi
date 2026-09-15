import { createElement as h } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
export function Markdown({ text }: { text: string }) {
  return h(
    "div",
    { className: "markdown" },
    h(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      skipHtml: true,
      urlTransform: (url) => (/^https?:\/\//i.test(url) ? url : ""),
      components: {
        a: ({ children, href }) =>
          href
            ? h(
                "a",
                { href, target: "_blank", rel: "noopener noreferrer" },
                children,
                " ↗",
              )
            : h("span", null, children),
        img: ({ alt }) =>
          h("span", { className: "image-placeholder" }, `▧ ${alt || "图片"}`),
        table: ({ children }) =>
          h("div", { className: "table-scroll" }, h("table", null, children)),
      },
      children: text,
    }),
  );
}
