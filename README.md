> For old version, please check out the repo: [Eorg](https://github.com/zhyd1997/Eorg).

[Documentation](https://github.com/SoftMaple/docs)

# Features

| Block Type   | Supported | Block Enum            | Notes                            |
|--------------|-----------|-----------------------|----------------------------------|
| Bold         | ✅ Yes     | `BOLD`                |                                  |
| Italic       | ✅ Yes     | `ITALIC`              |                                  |
| Underline    | ✅ Yes     | `UNDERLINE`           |                                  |
| Inline Code  | ✅ Yes     | `CODE`                |                                  |
| H1           | ✅ Yes     | `header-one`          |                                  |
| H2           | ✅ Yes     | `header-two`          |                                  |
| H3           | ✅ Yes     | `header-three`        |                                  |
| UL           | ✅ Yes     | `unordered-list-item` | only support for continuous list |
| OL           | ✅ Yes     | `ordered-list-item`   | only support for continuous list |
| Equation     | ✅ Yes     | `MATH`                | using `katex` for rendering      |
| Image        | ❌ Missing |                       |                                  |
| Table        | ❌ Missing |                       |                                  |
| Code Snippet | ❌ Missing |                       |                                  |

# Limitations

Not support [overlapping styles](https://draftjs.org/docs/advanced-topics-inline-styles/#overlapping-styles).

# Development

We use `pnpm` for package management, if you never used it, see [pnpm](https://pnpm.io/installation) for installation. 

```bash
pnpm install
pnpm dev
```
