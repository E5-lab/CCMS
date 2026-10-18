/**
 * CCMS Cloudflare Worker 入口
 * -------------------------------------------------------------
 * demo 阶段：仅作为静态资源（public/）的边缘托管层 + SPA 回退。
 * 后续接入 D1 数据库 / 多设备同步时，可在此扩展 /api/* 路由。
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 预留后端 API 位：确认方向后在此接入 D1 / 鉴权
    if (url.pathname.startsWith('/api/')) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: 'API 尚未启用。demo 使用浏览器本地存储（localStorage）。',
        }),
        {
          status: 501,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }
      );
    }

    // 其余请求交由 Static Assets 处理（含 SPA 单页回退）
    return env.ASSETS.fetch(request);
  },
};
