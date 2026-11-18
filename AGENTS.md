# 项目工作流

- 首选 `docker compose up -d --build`。镜像构建时 Node 打包网页、Go 运行测试并嵌入网页；运行容器不用 Node。默认发布到 `127.0.0.1:18326`，数据在 Compose 命名卷。
- `main` 分支的 GitHub Actions 在 x64 运行器原生构建并向 GHCR 发布 `linux/amd64` 镜像，不使用 QEMU。1Panel 使用 `compose.1panel.yaml` 拉取镜像，不执行构建。
- 若 Docker 不可用且 Go、Node 已安装，只用现有工具验证，不在宿主机安装软件。需要联网或调整部署环境时先由使用者确认。
- 保持学生端旧浏览器兼容：ES5 语法、XHR、无第三方运行时或外链资源；核心动作要支持鼠标、触摸和键盘。
