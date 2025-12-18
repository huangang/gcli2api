# gcli2api 零停机重新部署指南

## 快速开始

### 1. 赋予脚本执行权限

```bash
chmod +x redeploy.sh
```

### 2. 选择部署方法

```bash
# 方法 1: 快速重启(推荐日常使用)
./redeploy.sh quick

# 方法 2: 蓝绿部署(推荐生产环境,零停机)
./redeploy.sh blue-green

# 方法 3: 仅构建镜像
./redeploy.sh build

# 查看状态
./redeploy.sh status

# 回滚到上一个版本
./redeploy.sh rollback
```

---

## 部署方法详解

### 方法 1: 快速重启 (quick)

**适用场景**: 日常开发、测试环境、可接受短暂中断的场景

**特点**:
- ✅ 操作简单,一条命令完成
- ✅ 自动备份当前镜像
- ✅ 等待健康检查通过
- ⚠️ 有 5-10 秒的服务中断

**使用方法**:
```bash
./redeploy.sh quick
```

**执行流程**:
1. 备份当前运行的镜像
2. 重新构建新镜像
3. 强制重新创建容器
4. 等待健康检查通过
5. 完成部署

**预期输出**:
```
[INFO] 使用命令: docker compose
[INFO] === 方法 1: 快速重启 ===
[WARNING] 此方法会有 5-10 秒的服务中断
[INFO] 备份当前镜像...
[SUCCESS] 已备份镜像为: gcli2api_gcli2api:backup-20251218-143022
[INFO] 开始构建新镜像...
[SUCCESS] 新镜像构建完成
[INFO] 执行快速重启...
[INFO] 等待容器 gcli2api 健康检查通过...
[SUCCESS] 容器健康检查通过
[SUCCESS] 重启完成!
```

---

### 方法 2: 蓝绿部署 (blue-green)

**适用场景**: 生产环境、不能接受任何中断的场景

**特点**:
- ✅ 真正的零停机部署
- ✅ 新旧服务并行运行
- ✅ 自动验证新服务
- ✅ 失败自动回滚
- ⚠️ 需要临时占用额外端口(当前端口+1)

**使用方法**:
```bash
./redeploy.sh blue-green
```

**执行流程**:
1. 备份当前镜像
2. 构建新镜像
3. 在临时端口启动新容器(例如: 8086)
4. 等待新容器健康检查通过
5. 验证新服务是否正常响应
6. 停止旧容器
7. 将新容器切换到原端口(例如: 8085)
8. 完成部署

**预期输出**:
```
[INFO] === 方法 2: 蓝绿部署(零停机) ===
[INFO] 当前端口: 8085, 临时端口: 8086
[INFO] 备份当前镜像...
[SUCCESS] 已备份镜像为: gcli2api_gcli2api:backup-20251218-143022
[INFO] 在端口 8086 启动新容器...
[INFO] 等待容器 gcli2api-new 健康检查通过...
[SUCCESS] 容器健康检查通过
[INFO] 验证新服务...
[SUCCESS] 新服务验证通过
[INFO] 停止旧容器...
[INFO] 将新容器切换到端口 8085...
[SUCCESS] 蓝绿部署完成!
```

**注意事项**:
- 确保临时端口(当前端口+1)未被占用
- 整个过程中,服务始终可用
- 如果新服务启动失败,会自动清理并保持旧服务运行

---

### 方法 3: 仅构建 (build)

**适用场景**: 提前构建镜像,稍后再部署

**特点**:
- ✅ 只构建镜像,不影响运行中的服务
- ✅ 可以提前验证构建是否成功
- ✅ 适合在低峰期构建,高峰期快速切换

**使用方法**:
```bash
# 先构建
./redeploy.sh build

# 稍后部署
./redeploy.sh quick
```

---

### 回滚功能 (rollback)

**适用场景**: 新版本有问题,需要快速恢复到上一个版本

**特点**:
- ✅ 快速回滚到最近的备份镜像
- ✅ 自动查找最新备份
- ✅ 需要手动确认

**使用方法**:
```bash
./redeploy.sh rollback
```

**交互示例**:
```
[INFO] === 回滚到备份镜像 ===
[INFO] 找到备份镜像: gcli2api_gcli2api:backup-20251218-143022
确认回滚到此镜像? (y/N): y
[INFO] 执行快速重启...
[SUCCESS] 回滚完成!
```

---

## 查看状态

```bash
./redeploy.sh status
```

**输出示例**:
```
[INFO] === 当前容器状态 ===
NAMES      STATUS              PORTS   IMAGE
gcli2api   Up 4 hours (healthy)        gcli2api_gcli2api

[INFO] === 可用的备份镜像 ===
REPOSITORY          TAG                         CREATED AT
gcli2api_gcli2api   backup-20251218-143022     2025-12-18 14:30:22 +0800 CST
gcli2api_gcli2api   backup-20251218-120000     2025-12-18 12:00:00 +0800 CST
```

---

## 常见场景

### 场景 1: 代码更新后重新部署(开发环境)

```bash
# 修改代码后
git pull
./redeploy.sh quick
```

### 场景 2: 生产环境更新(零停机)

```bash
# 拉取最新代码
git pull

# 零停机部署
./redeploy.sh blue-green

# 如果有问题,立即回滚
./redeploy.sh rollback
```

### 场景 3: 提前构建,择机部署

```bash
# 白天构建
./redeploy.sh build

# 晚上低峰期快速部署
./redeploy.sh quick
```

### 场景 4: 验证新版本后再切换

```bash
# 使用蓝绿部署,手动验证
./redeploy.sh blue-green

# 在切换前,新服务运行在临时端口
# 可以手动测试: curl http://localhost:8086/v1/models

# 验证通过后,脚本会自动切换
```

---

## 故障排查

### 问题 1: 健康检查超时

**现象**:
```
[ERROR] 健康检查超时
```

**解决方法**:
1. 检查应用日志: `docker logs gcli2api`
2. 检查端口是否被占用: `netstat -tlnp | grep 8085`
3. 增加健康检查超时时间(编辑脚本中的 `HEALTH_CHECK_TIMEOUT`)

### 问题 2: 端口被占用(蓝绿部署)

**现象**:
```
Error: port is already allocated
```

**解决方法**:
1. 检查端口占用: `netstat -tlnp | grep 8086`
2. 停止占用端口的服务
3. 或者使用 quick 方法

### 问题 3: 构建失败

**现象**:
```
[ERROR] 新镜像构建失败
```

**解决方法**:
1. 检查 Dockerfile 语法
2. 检查依赖是否可用
3. 手动构建查看详细错误: `docker compose build`

### 问题 4: 回滚失败,没有备份镜像

**现象**:
```
[ERROR] 未找到备份镜像
```

**解决方法**:
- 备份镜像在首次使用脚本部署时才会创建
- 如果是首次使用,无法回滚
- 建议定期手动备份: `docker tag gcli2api_gcli2api:latest gcli2api_gcli2api:manual-backup`

---

## 高级配置

### 修改健康检查超时时间

编辑 `redeploy.sh`:
```bash
HEALTH_CHECK_TIMEOUT=120  # 改为 120 秒
```

### 修改临时容器名称

编辑 `redeploy.sh`:
```bash
TEMP_CONTAINER_NAME="gcli2api-staging"
```

### 保留更多备份镜像

脚本会自动创建带时间戳的备份,不会自动删除。如需清理旧备份:

```bash
# 查看所有备份
docker images | grep backup-

# 删除指定备份
docker rmi gcli2api_gcli2api:backup-20251218-120000

# 删除 7 天前的备份
docker images --format "{{.Repository}}:{{.Tag}}" | \
  grep "gcli2api_gcli2api:backup-" | \
  while read img; do
    created=$(docker inspect --format='{{.Created}}' "$img")
    # 根据时间判断并删除
  done
```

---

## 最佳实践

1. **开发环境**: 使用 `quick` 方法,快速迭代
2. **生产环境**: 使用 `blue-green` 方法,确保零停机
3. **定期备份**: 脚本会自动备份,但建议定期手动创建重要版本的备份
4. **监控日志**: 部署后检查日志: `docker logs -f gcli2api`
5. **验证服务**: 部署后验证关键接口是否正常
6. **保留回滚窗口**: 部署后观察一段时间,确认无问题后再删除备份

---

## 脚本特性

- ✅ 自动检测 `docker compose` 或 `docker-compose` 命令
- ✅ 彩色输出,清晰易读
- ✅ 自动备份当前镜像
- ✅ 健康检查等待
- ✅ 失败自动回滚(蓝绿部署)
- ✅ 详细的日志输出
- ✅ 错误处理(set -e)

---

## 技术细节

### 快速重启原理

使用 `docker compose up -d --wait --force-recreate`:
- `--wait`: 等待健康检查通过
- `--force-recreate`: 强制重新创建容器
- `-d`: 后台运行

### 蓝绿部署原理

1. 使用不同的项目名称(`-p $TEMP_PROJECT_NAME`)启动新容器
2. 新旧容器使用不同端口,互不影响
3. 验证新容器后,停止旧容器
4. 重新启动容器到原端口

### 备份机制

- 使用 `docker tag` 创建镜像快照
- 备份命名格式: `gcli2api_gcli2api:backup-YYYYMMDD-HHMMSS`
- 不占用额外磁盘空间(只是标签)

---

## 许可证

此脚本由 Claude Code 生成,可自由使用和修改。

## 支持

如有问题,请检查:
1. Docker 和 Docker Compose 版本
2. docker-compose.yml 配置
3. 容器日志: `docker logs gcli2api`
4. 脚本执行权限: `chmod +x redeploy.sh`
