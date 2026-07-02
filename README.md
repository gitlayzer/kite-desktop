# Kite Desktop

Kite Desktop 是基于开源项目
[kite-org/kite](https://github.com/kite-org/kite) 改造的桌面版 Kubernetes
管理工具。当前版本将 Kite 打包成 macOS / Windows 应用，移除了多租户登录流程，
面向单管理员本地桌面使用：打开应用，导入或选择 kubeconfig，然后直接管理集群资源。

## 功能特性

- macOS 和 Windows 桌面应用。
- 单 admin 模式，无需登录即可使用。
- 首次进入选择集群，应用内支持集群切换、kubeconfig 导入和删除。
- 中文优先界面，默认固定为 Claude 风格主题。
- 保留 Kite 的核心 Kubernetes 管理能力，包括资源浏览、YAML 编辑、日志、终端、
  Helm Release、CRD、工作负载详情、事件和关联资源视图。
- 面向大集群做了保护：
  - 资源列表使用游标分页；
  - 列表视图减少返回字段；
  - watch 缓存有上限；
  - All Namespaces 查询避免一次性加载全量对象；
  - 概览统计采用 best-effort 方式，避免为了统计把整个集群拉到内存。
- 内置桌面访问保护，后端默认服务于打包后的 App，而不是普通浏览器页面。

## 下载

安装包通过 GitHub Releases 发布：

- macOS Apple Silicon: `Kite-<version>-mac-arm64.dmg`
- macOS Intel: `Kite-<version>-mac-x64.dmg`
- Windows x64: `Kite-<version>-win-x64.exe`

当前 macOS 构建会进行 ad-hoc 签名，打包脚本会校验 App bundle 的签名完整性。
这可以避免未封装 App 在其他电脑上被直接判定为损坏。公开分发时如果希望从浏览器
下载后完全不出现系统拦截，还需要使用 Apple Developer ID 证书签名并完成 notarization。
如果你确认安装包来源可信，但 macOS 仍拦截首次打开，请到
System Settings > Privacy & Security 中允许打开。

## 从源码构建

依赖：

- Go 1.26+
- Node.js 20.19+ 或 22.12+
- pnpm
- macOS 环境用于构建 DMG

构建后端和前端：

```bash
make build
```

构建当前 macOS arm64 App：

```bash
./scripts/build-macos-app.sh
```

构建 macOS arm64、macOS x64、Windows x64 安装包：

```bash
./scripts/build-desktop-installers.sh
```

生成产物位置：

```text
desktop/dist/
desktop/dist/installers/
```

## 开发检查

发布前建议执行：

```bash
go test ./...
pnpm --dir ui type-check
pnpm --dir ui test
pnpm --dir ui build
```

Electron 应用会启动内置 Kite 后端，并在桌面窗口中加载本地 Web UI。
生成的安装包、`desktop/resources`、`desktop/dist`、`node_modules` 和工作流临时文件
不会提交到仓库。

## 与 Kite 的关系

本项目是 [kite-org/kite](https://github.com/kite-org/kite) 的桌面发行版和产品适配版。
核心 Kubernetes Dashboard、资源模型以及大量前后端实现都来自 Kite。

感谢 Kite 的维护者和所有贡献者提供了优秀的开源项目。原始项目文档、历史和社区信息
请查看上游仓库：[kite-org/kite](https://github.com/kite-org/kite)。

## License

本项目沿用上游 Apache License 2.0。详见 [LICENSE](./LICENSE)。
