# Image caching contract

[简体中文](#图片缓存合同)

Use browser HTTP caching to avoid retransmitting images across Praxis and its independent apps. Inspect the actual image handler, production adapter and gateway; a browser cache option alone does not fix an origin that returns `no-store` or lacks validators. New image surfaces follow this contract too. This does not authorize caching all application responses or adding a CDN, image store, service worker or upload API.

| Resource | Policy |
|---|---|
| Ordinary static images | `private, max-age=3600, must-revalidate`, ETag and Last-Modified. Fresh responses reuse browser bytes; expired or explicitly refreshed responses validate. |
| Mutable generated or scoped-share images | `private, no-cache, must-revalidate`, with validators. Store bytes but validate each reuse. |
| Explicitly sensitive images | Preserve an owning app's justified stricter policy; document the exception instead of silently exposing data through a shared cache. |
| Inline icons, data URLs and existing local photo stores | Already avoid separate image downloads; do not invent an HTTP endpoint or duplicate local storage. |
| Development image servers | Framework revalidation is acceptable when ETag/304 actually work and hot updates remain visible. Do not assume production inherits it. |

Classify successful **resolved image content types**, not a request suffix: a missing `.png` can return HTML in a single-page app. Cover SVG, PNG, JPEG, WebP, GIF, AVIF and icons where the app serves them. Keep HTML, business/API JSON, authorization failures, missing files, redirects and non-image media under their existing policy. Error responses must not acquire a positive image freshness lifetime.

Apply GET/HEAD conditions only after real-path containment and authorization. Return a stable validator, Last-Modified and the appropriate cache policy on 200 and 304. A matching If-None-Match takes precedence over If-Modified-Since; handle weak validators, lists and `*` for these methods. A 304 has no image body or full-image Content-Length. HEAD returns the corresponding headers without bytes. File replacement must change the validator, including a same-size replacement; explicit refresh or expiry must reveal the changed image. Preserve existing byte-range semantics for other media.

Use private caches, and vary protected image representations by the credential that selected the response. The standalone image helper varies by `Authorization`; the managed gateway varies by the session `Cookie`. Never turn protected images into public/shared-proxy cache entries. A share URL already identifies its scope, but expiry/revocation still runs **before every conditional response**. The current Travel share gateway therefore overrides image freshness with private revalidation, while share HTML and errors remain `no-store`. Do not append version query strings to capability URLs that explicitly forbid queries. Do not claim revocation erases bytes a recipient has already downloaded.

Keep implementation owned by each independent app. Root serving adapters may reuse a root helper; apps must not import Praxis to obtain caching. Verify each existing image surface or record why it is already local/inline. Server-side tests should exercise first 200, HEAD, empty 304, validator precedence, replacement, errors and containment with synthetic images. Browser evidence should show a warm-cache reuse or zero image-body transfer on revalidation, while mutable content and invalid/revoked shares remain correct. Restart only processes that hold changed server code, then check running local and prefixed paths.

Reference: [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html), especially private caches, freshness, and validation. These TTLs are Praxis defaults, not values mandated by the RFC.

In a multi-proxy deployment, an HTTP writer may remove Content-Type from a 304. Classify images at the trusted relay before that happens, carry the classification internally, and remove internal metadata at the public edge. Test the actual proxy chain, including an HTML 304 with the same cache headers and forged metadata; neither request suffixes nor validators alone prove an image representation.

## 图片缓存合同

检查实际图片处理器、生产适配层和网关返回的 HTTP 响应。静态图片使用浏览器私有缓存，避免重复传输；可变图片及受分享范围限制的图片每次复用前都需重新验证。具体规则如下。

| 资源 | 策略 |
| --- | --- |
| 普通静态图片 | `private, max-age=3600, must-revalidate`，提供 ETag 和 Last-Modified。有效期内可复用本地内容；到期或主动刷新时进行验证。 |
| 可变生成图片或分享图片 | `private, no-cache, must-revalidate`，提供校验值。浏览器可保存内容，每次使用前需向服务验证。 |
| 明确敏感的图片 | 沿用归属应用更严格的策略，记录例外原因。 |
| 内联图标、data URL 和已有本地相册 | 这些图片已经避免了单独下载，继续沿用原有存储与展示方式。 |
| 开发服务 | 实测 ETag、304 和热更新。生产服务按实际响应单独核验。 |

根据成功响应的实际媒体类型分类。单页应用可能为缺失的 PNG 返回 HTML；保留 HTML、业务 JSON、拒绝访问、重定向和错误响应原有的缓存策略。覆盖应用实际提供的 SVG、PNG、JPEG、WebP、GIF、AVIF 和图标。

校验真实路径和权限后再处理 GET/HEAD 条件请求。200 和 304 均返回相应缓存策略及校验值。`If-None-Match` 优先于 `If-Modified-Since`，处理弱校验值、列表和 `*`。304 不返回图片正文或整张图片的 Content-Length。HEAD 返回相应响应头。即便替换后的文件大小相同，也要能在刷新或到期后获得新图。保留其他媒体原有的范围请求行为。

受保护图片采用私有缓存，按选择该表示的凭据设置 Vary。独立图片处理器使用 `Authorization`，受管网关使用会话 `Cookie`。每次条件请求都先检查分享是否过期或被撤销。Travel 分享图片每次重新验证，分享 HTML 和错误响应继续使用 `no-store`。禁止查询参数的能力 URL 应保留原样。已下载到接收方设备的内容仍可能保留。

用合成图片覆盖首次 200、HEAD、无正文的 304、校验值优先级、同大小替换、错误和路径约束。浏览器验收应观察到命中缓存或重新验证时无图片正文传输，同时检查可变内容与撤权行为。只重启持有已改服务代码的进程，并核对本机及前缀路径。多层代理可能会移除 304 的 Content-Type；在可信中继分类，在公开边缘移除内部分类标记。使用同样带缓存头的 HTML 304 和伪造的分类标记检验代理链。

缓存时长属于 Praxis 的默认策略，HTTP 缓存语义见 [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html)。
