#!/bin/bash

# gcli2api 零停机重新部署脚本
# 作者: Claude Code
# 日期: 2025-12-18

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
CONTAINER_NAME="gcli2api"
TEMP_CONTAINER_NAME="gcli2api-new"
TEMP_PROJECT_NAME="gcli2api-temp"
HEALTH_CHECK_TIMEOUT=60  # 健康检查超时时间(秒)
BACKUP_IMAGE_TAG="gcli2api_gcli2api:backup-$(date +%Y%m%d-%H%M%S)"

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查 docker compose 命令
check_docker_compose() {
    if docker compose version &> /dev/null; then
        DOCKER_COMPOSE="docker compose"
    elif docker-compose version &> /dev/null; then
        DOCKER_COMPOSE="docker-compose"
    else
        log_error "未找到 docker compose 或 docker-compose 命令"
        exit 1
    fi
    log_info "使用命令: $DOCKER_COMPOSE"
}

# 检查当前容器状态
check_current_container() {
    if ! docker ps --filter "name=$CONTAINER_NAME" --format "{{.Names}}" | grep -q "^$CONTAINER_NAME$"; then
        log_warning "当前没有运行中的 $CONTAINER_NAME 容器"
        return 1
    fi
    log_info "当前容器状态:"
    docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    return 0
}

# 备份当前镜像
backup_current_image() {
    log_info "备份当前镜像..."
    local current_image=$(docker inspect $CONTAINER_NAME --format='{{.Image}}' 2>/dev/null || echo "")
    if [ -n "$current_image" ]; then
        docker tag $current_image $BACKUP_IMAGE_TAG
        log_success "已备份镜像为: $BACKUP_IMAGE_TAG"
    else
        log_warning "无法备份当前镜像"
    fi
}

# 构建新镜像
build_new_image() {
    log_info "开始构建新镜像..."
    $DOCKER_COMPOSE build
    log_success "新镜像构建完成"
}

# 获取当前端口
get_current_port() {
    local port=$(docker inspect $CONTAINER_NAME --format='{{range $key, $value := .Config.Env}}{{if eq $key "PORT"}}{{$value}}{{end}}{{end}}' 2>/dev/null || echo "8085")
    if [ -z "$port" ]; then
        port="8085"
    fi
    echo $port
}

# 健康检查
wait_for_healthy() {
    local container_name=$1
    local timeout=$2
    local elapsed=0

    log_info "等待容器 $container_name 健康检查通过..."

    while [ $elapsed -lt $timeout ]; do
        local health_status=$(docker inspect --format='{{.State.Health.Status}}' $container_name 2>/dev/null || echo "none")

        if [ "$health_status" = "healthy" ]; then
            log_success "容器健康检查通过"
            return 0
        elif [ "$health_status" = "none" ]; then
            # 没有健康检查,检查容器是否在运行
            if docker ps --filter "name=$container_name" --format "{{.Names}}" | grep -q "^$container_name$"; then
                log_warning "容器没有配置健康检查,等待 10 秒..."
                sleep 10
                return 0
            fi
        fi

        echo -n "."
        sleep 2
        elapsed=$((elapsed + 2))
    done

    echo ""
    log_error "健康检查超时"
    return 1
}

# 方法 1: 快速重启(推荐,简单但有短暂中断)
method_quick_restart() {
    log_info "=== 方法 1: 快速重启 ==="
    log_warning "此方法会有 5-10 秒的服务中断"

    backup_current_image
    build_new_image

    log_info "停止旧容器..."
    $DOCKER_COMPOSE down

    log_info "启动新容器..."
    $DOCKER_COMPOSE up -d

    # 等待容器健康
    if ! wait_for_healthy $CONTAINER_NAME $HEALTH_CHECK_TIMEOUT; then
        log_error "容器启动失败"
        exit 1
    fi

    log_success "重启完成!"
    docker ps --filter "name=$CONTAINER_NAME"
}

# 方法 2: 蓝绿部署(零停机,推荐用于生产环境)
method_blue_green() {
    log_info "=== 方法 2: 蓝绿部署(零停机) ==="

    local current_port=$(get_current_port)
    local temp_port=$((current_port + 1))

    log_info "当前端口: $current_port, 临时端口: $temp_port"

    backup_current_image
    build_new_image

    # 启动新容器
    log_info "在端口 $temp_port 启动新容器..."
    PORT=$temp_port $DOCKER_COMPOSE -p $TEMP_PROJECT_NAME up -d

    # 等待新容器健康
    if ! wait_for_healthy $TEMP_CONTAINER_NAME $HEALTH_CHECK_TIMEOUT; then
        log_error "新容器启动失败,回滚..."
        PORT=$temp_port $DOCKER_COMPOSE -p $TEMP_PROJECT_NAME down
        exit 1
    fi

    # 验证新服务
    log_info "验证新服务..."
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:$temp_port/v1/models | grep -q "200\|401"; then
        log_success "新服务验证通过"
    else
        log_error "新服务验证失败,回滚..."
        PORT=$temp_port $DOCKER_COMPOSE -p $TEMP_PROJECT_NAME down
        exit 1
    fi

    # 停止旧容器
    log_info "停止旧容器..."
    $DOCKER_COMPOSE down

    # 将新容器切换到原端口
    log_info "将新容器切换到端口 $current_port..."
    PORT=$temp_port $DOCKER_COMPOSE -p $TEMP_PROJECT_NAME down
    PORT=$current_port $DOCKER_COMPOSE up -d

    if ! wait_for_healthy $CONTAINER_NAME $HEALTH_CHECK_TIMEOUT; then
        log_error "最终容器启动失败"
        exit 1
    fi

    log_success "蓝绿部署完成!"
    docker ps --filter "name=$CONTAINER_NAME"
}

# 方法 3: 仅重新构建(不重启)
method_build_only() {
    log_info "=== 方法 3: 仅重新构建镜像 ==="

    backup_current_image
    build_new_image

    log_success "镜像构建完成,容器未重启"
    log_info "如需应用更改,请运行: $0 quick 或 $0 blue-green"
}

# 回滚到备份镜像
method_rollback() {
    log_info "=== 回滚到备份镜像 ==="

    # 查找最新的备份镜像
    local latest_backup=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep "gcli2api_gcli2api:backup-" | head -n 1)

    if [ -z "$latest_backup" ]; then
        log_error "未找到备份镜像"
        exit 1
    fi

    log_info "找到备份镜像: $latest_backup"
    read -p "确认回滚到此镜像? (y/N): " confirm

    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        log_info "取消回滚"
        exit 0
    fi

    # 标记备份镜像为当前镜像
    docker tag $latest_backup gcli2api_gcli2api:latest

    # 重启容器
    log_info "停止当前容器..."
    $DOCKER_COMPOSE down

    log_info "启动回滚版本..."
    $DOCKER_COMPOSE up -d

    log_success "回滚完成!"
    docker ps --filter "name=$CONTAINER_NAME"
}

# 显示帮助
show_help() {
    cat << EOF
gcli2api 零停机重新部署脚本

用法: $0 [方法]

方法:
  quick       快速重启(推荐,有 5-10 秒中断)
  blue-green  蓝绿部署(零停机,推荐生产环境)
  build       仅重新构建镜像,不重启容器
  rollback    回滚到上一个备份镜像
  status      查看当前容器状态
  help        显示此帮助信息

示例:
  $0 quick              # 快速重启
  $0 blue-green         # 零停机部署
  $0 build              # 仅构建
  $0 rollback           # 回滚

注意:
  - quick 方法最简单,但有短暂中断(5-10秒)
  - blue-green 方法零停机,但需要临时占用额外端口
  - 每次部署前都会自动备份当前镜像
  - 使用 rollback 可以快速恢复到备份版本

EOF
}

# 显示状态
show_status() {
    log_info "=== 当前容器状态 ==="
    docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"

    echo ""
    log_info "=== 可用的备份镜像 ==="
    docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.CreatedAt}}" | grep -E "REPOSITORY|backup-" || log_warning "没有备份镜像"
}

# 主函数
main() {
    check_docker_compose

    case "${1:-quick}" in
        quick)
            method_quick_restart
            ;;
        blue-green)
            method_blue_green
            ;;
        build)
            method_build_only
            ;;
        rollback)
            method_rollback
            ;;
        status)
            show_status
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "未知方法: $1"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
