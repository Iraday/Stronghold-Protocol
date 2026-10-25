# 陈千语：例行更新

在本 fork 的 `main` 工作区操作。服务器是 `colorcrossingNY`，安装目录是 `/opt/stronghold`。
**只部署改过的插件：改图片只更新美术包，不重新部署玩法或重建游戏服务器。**

## 只改图片、语音或外观

1. 更新 `plugins/chen-qianyu-art/` 的素材和 `plugin.json` 版本号；同步
   `artwork/chen-qianyu.json` 的版本。在游戏里的实际卡片尺寸查看效果。
2. 打包、上传、调用现有脚本（PowerShell；版本号按本次修改填写）：

```powershell
$artVersion = '1.1.13'
node tools/plugin.mjs pack chen-qianyu-art --strict
if ($LASTEXITCODE -ne 0) { throw 'Pack failed' }
New-Item -ItemType Directory -Force plugins/_dist | Out-Null
tar -czf "plugins/_dist/cqy-art-$artVersion.tar.gz" -C plugins chen-qianyu-art
scp "plugins/_dist/cqy-art-$artVersion.tar.gz" colorcrossingNY:/opt/stronghold/
ssh colorcrossingNY "bash /opt/stronghold/deploy-cqy-art.sh $artVersion"
```

脚本会保留旧版本、热替换美术包并创建一个测试房间。看到 `OK: new rooms get ...` 即完成安装。
更新服务器留给下次整包安装使用的插件归档：

```powershell
ssh colorcrossingNY 'tar -czf /opt/stronghold/cqy-plugins.tar.gz -C /var/lib/docker/volumes/stronghold-plugins/_data chen-qianyu chen-qianyu-art'
```

## 同时修改玩法

先更新玩法版本，运行该插件测试和 `pack chen-qianyu --strict`，同样生成并上传
`cqy-<玩法版本>.tar.gz`（归档内是 `chen-qianyu/`）。服务器上依次执行：

```sh
bash /opt/stronghold/deploy-cqy-art.sh 1.1.13 && bash /opt/stronghold/deploy-cqy.sh 1.0.18
```

只改玩法时只执行第二条。玩法脚本会测试新房间、运行插件测试并刷新整包安装归档。
若它报告有对局正在进行，等对局结束；维护者已明确授权热更新时可用 `FORCE=1 bash ...`。
该选项不结束对局，但首次加载新玩法可能短暂停顿。不要把重新安装相同版本当作必需步骤。

## 推送 GitHub

确认改动包括素材、清单、匹配的 `plugin.lock.json` 和相关说明，再提交到本 fork：

```sh
git diff --stat
git add -A
git commit -m "Update Chen Qianyu artwork"
git push fork main
```

`fork` 应是 `Iraday/Stronghold-Protocol`。素材版权说明保留；服务器配置、密钥、缓存、官方参考图和归档不提交。
现有房间点击 **重新应用**，或开新房间加载新版本。

**检查范围：**美术更新以实际界面对照、严格打包和脚本自带的新房间探针为准；玩法改动运行插件测试。
修改编辑器或游戏引擎时才扩大到对应测试。纯美术发布不需要重跑全仓 CI、golden 或同一组测试多次。
只有脚本报错、校验失败或实际显示异常时，才展开额外诊断。
