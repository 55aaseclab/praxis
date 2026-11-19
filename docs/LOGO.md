# How the Praxis pine grows

[简体中文](#简体中文) · [Transparent SVG](brand/praxis-pine.svg) · [Generator](../scripts/generate-logo.mjs)

<img src="brand/praxis-pine.svg" width="260" alt="A pine with a short trunk and a crown swept to the right">

The pine is the current Praxis mark. Its single trunk stands for the agent a person addresses. Its branches spread into the apps that carry out the request. The gap below the upper crown keeps the direction of growth visible even in the workbench dock.

## Reproduce the mark

From the repository root, use Node.js 22.16 or later and install the locked development dependencies.

```sh
npm ci
npm run logo:generate
npm run logo:check
```

The generator takes numeric parameters as its only visual input. It computes one silhouette, writes it as SVG and places it on a square tile. A pinned version of resvg renders the tile to PNG. The check regenerates the assets in memory and compares all five files byte for byte.

| Asset | Use |
| --- | --- |
| [Wide SVG](brand/praxis-pine.svg) | Transparent mark for layouts with a light background |
| [Square SVG](../public/praxis.svg) | README, browser tab and workbench dock |
| [180 px](../public/praxis-180.png) · [192 px](../public/praxis-192.png) · [512 px](../public/praxis-512.png) | Apple touch icon and web app installation icons |

## Geometry

**1. Bend a branch toward the wind.** Work in a plane where the positive y-axis points up. For a branch starting at $P$, with length scale $L$ and initial heading $\theta$, sample the centerline at 17 equally spaced values of $t$ from 0 to 1.

$$
B(t) = P + L\left(t\cos\theta + wt^2,\ t\sin\theta\right).
$$

The trunk starts at the origin with $L=1$, $\theta=113°$ and half-width $0.14$. The rightward drift $w$ is 0.73 for the trunk and 0.17 for the branches. Offsetting each centerline along its unit normal by $r(1-0.44t)$ gives the branch its two edges. The trunk has an extra basal flare and a level base.

**2. Branch three times.** Each parent grows two children. Attachment is measured along the parent's parameter $t$. The angle offset is measured from its tangent heading $\phi$ at that point.

| Child | Attachment | Angle offset | Length × | Starting half-width × |
| --- | ---: | ---: | ---: | ---: |
| Upright | 1.00 | +79° | 0.61 | 0.66 |
| Downwind | 0.86 | −26° | 0.80 | 0.73 |

The child's heading is $0.87(\phi+\Delta)+0.13(16°)$. This small bias toward the same wind direction accumulates through the tree. Three rounds give 15 woody segments and eight terminal foliage pads.

**3. Grow a canopy at each tip.** For a terminal branch of length scale $L$, the pad width is $2.2(0.58+0.75L)$ and its height scale is $0.59(0.74+0.46L)$. Its basic envelope is

$$
A(u)=2.6u^{0.53}(1-u)^{1.18},\qquad 0\le u\le1.
$$

The different powers form a full shoulder and a longer tapered tip. The branch meets the pad at 47% of its width. A slight upward slope and a sinusoidal modulation of the upper edge give the overlapping pads their low, windswept profile. Each edge is sampled at 41 points.

**4. Fit the silhouette.** All shapes use pure black, `#000000`. The generator flips the y-axis for SVG and scales the tree to 224 units wide. The icon centers it in a 256-unit rounded square on `#FFFFFF`. To adjust the design, change the generator, run the commands above, and inspect the result at 16 and 24 px as well as at full size.

## 简体中文

[透明 SVG](brand/praxis-pine.svg) · [生成脚本](../scripts/generate-logo.mjs)

偏冠松是 Praxis 现阶段使用的标识。树干代表人面对的一个 agent，分枝代表承接请求的不同应用。上层树冠下方留出一道空隙，缩到工作台图标大小时，也能看出整棵树顺风生长的方向。

**复现。** 在仓库根目录使用 Node.js 22.16 或更高版本，依次运行 `npm ci`、`npm run logo:generate` 和 `npm run logo:check`。生成器的视觉输入只有数值参数。它计算出一套轮廓，输出透明 SVG 和方形 SVG，再通过锁定版本的 resvg 从方形 SVG 导出 180、192、512 像素 PNG。校验命令在内存中重算五个文件，逐字节比对。

**树干与分枝。** 上方第一式定义枝条中心线。$P$ 是起点，$L$ 是长度尺度，$\theta$ 是起始方向，$wt^2$ 让枝条向右弯。树干从原点出发，朝向 113°，长度尺度为 1，初始半宽为 0.14。树干的风偏系数为 0.73，分枝为 0.17。每条中心线取 17 个等距参数点，沿法线向两侧展开，半宽按 $r(1-0.44t)$ 收窄；树干底部额外加宽并收平。

**递归。** 每条母枝长出两条子枝。上行枝从末端长出，相对切线偏转 +79°，长度与半宽分别乘 0.61、0.66。顺风枝从参数 0.86 处长出，偏转 −26°，长度与半宽分别乘 0.80、0.73。子枝方向取“局部切线加偏转角”的 87%，再加统一风向 16° 的 13%。重复三层，共得到 15 段枝干、8 个树冠末梢。

**树冠。** 末梢针叶团宽度为 $2.2(0.58+0.75L)$，高度尺度为 $0.59(0.74+0.46L)$。上方的包络函数 $A(u)$ 用不同的两端指数生成浑圆的肩部和细长的尖端。枝条接在宽度的 47% 处，叶团整体略向右上倾斜，上缘由正弦项轻微起伏。上下缘各取 41 个点，叠成松树的层状树冠。

**成形。** 轮廓使用纯黑 `#000000`。生成器将纵轴翻转为 SVG 坐标，把树缩放到 224 单位宽，再居中放在 256 单位的纯白圆角方块 `#FFFFFF` 内。修改造型时，编辑脚本参数并重新生成，同时检查 16、24 像素和原尺寸下的轮廓。
