// Connect before loading the router: route normalization may remove the token hash.
import "./csp-nonce";

// 用户在同一标签页打开终端的新链接时，只有 hash 变化（同一文档导航，不重新加载页面）。
// 监听 hashchange 并重新执行 connect，使整页授权引导可以恢复。
const reauth = () => {
  const hash = new URLSearchParams(location.hash.slice(1)).get("token");
  if (hash) {
    void import("./api").then(({ connect }) =>
      connect().then(() => location.reload()).catch(() => undefined),
    );
  }
};
window.addEventListener("hashchange", reauth);
void import("./api")
  .then(({ connect }) => connect().catch(() => undefined))
  .then(() => import("./v2/app"))
  .then(({ mountWorkbench }) => mountWorkbench(document.getElementById("root")!));
