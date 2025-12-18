// =====================================================================
// GCLI2API 控制面板公共JavaScript模块
// =====================================================================

// =====================================================================
// 全局状态管理
// =====================================================================
const AppState = {
    // 认证相关
    authToken: '',
    authInProgress: false,
    currentProjectId: '',

    // Antigravity认证
    antigravityAuthState: null,
    antigravityAuthInProgress: false,

    // 凭证管理
    creds: createCredsManager('normal'),
    antigravityCreds: createCredsManager('antigravity'),

    // 文件上传
    uploadFiles: createUploadManager('normal'),
    antigravityUploadFiles: createUploadManager('antigravity'),

    // 配置管理
    currentConfig: {},
    envLockedFields: new Set(),

    // 日志管理
    logWebSocket: null,
    allLogs: [],
    filteredLogs: [],
    currentLogFilter: 'all',

    // 使用统计
    usageStatsData: {},

    // 冷却倒计时
    cooldownTimerInterval: null
};

// =====================================================================
// 凭证管理器工厂
// =====================================================================
function createCredsManager(type) {
    const isAntigravity = type === 'antigravity';
    const apiPrefix = isAntigravity ? '/antigravity' : '';

    return {
        type: type,
        data: {},
        filteredData: {},
        currentPage: 1,
        pageSize: 20,
        selectedFiles: new Set(),
        totalCount: 0,
        currentStatusFilter: 'all',
        statsData: { total: 0, normal: 0, disabled: 0 },

        // API端点
        getEndpoint: (action) => {
            const endpoints = {
                status: `.${apiPrefix}/creds/status`,
                action: `.${apiPrefix}/creds/action`,
                batchAction: `.${apiPrefix}/creds/batch-action`,
                download: `.${apiPrefix}/creds/download`,
                downloadAll: `.${apiPrefix}/creds/download-all`,
                detail: `.${apiPrefix}/creds/detail`,
                fetchEmail: `.${apiPrefix}/creds/fetch-email`,
                refreshAllEmails: `.${apiPrefix}/creds/refresh-all-emails`
            };
            return endpoints[action] || '';
        },

        // DOM元素ID前缀
        getElementId: (suffix) => {
            // 普通凭证的ID首字母小写,如 credsLoading
            // Antigravity的ID是 antigravity + 首字母大写,如 antigravityCredsLoading
            if (isAntigravity) {
                return 'antigravity' + suffix.charAt(0).toUpperCase() + suffix.slice(1);
            }
            return suffix.charAt(0).toLowerCase() + suffix.slice(1);
        },

        // 刷新凭证列表
        async refresh() {
            const loading = document.getElementById(this.getElementId('CredsLoading'));
            const list = document.getElementById(this.getElementId('CredsList'));

            try {
                loading.style.display = 'block';
                list.innerHTML = '';

                const offset = (this.currentPage - 1) * this.pageSize;
                const response = await fetch(
                    `${this.getEndpoint('status')}?offset=${offset}&limit=${this.pageSize}&status_filter=${this.currentStatusFilter}`,
                    { headers: getAuthHeaders() }
                );

                const data = await response.json();

                if (response.ok) {
                    this.data = {};
                    data.items.forEach(item => {
                        this.data[item.filename] = {
                            filename: item.filename,
                            status: {
                                disabled: item.disabled,
                                error_codes: item.error_codes || [],
                                last_success: item.last_success,
                            },
                            user_email: item.user_email,
                            model_cooldowns: item.model_cooldowns || {}
                        };
                    });

                    this.totalCount = data.total;
                    this.calculateStats();
                    this.updateStatsDisplay();
                    this.filteredData = this.data;
                    this.renderList();
                    this.updatePagination();

                    let msg = `已加载 ${data.total} 个${isAntigravity ? 'Antigravity' : ''}凭证文件`;
                    if (this.currentStatusFilter !== 'all') {
                        msg += ` (筛选: ${this.currentStatusFilter === 'enabled' ? '仅启用' : '仅禁用'})`;
                    }
                    showStatus(msg, 'success');
                } else {
                    showStatus(`加载失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            } finally {
                loading.style.display = 'none';
            }
        },

        // 计算统计数据
        calculateStats() {
            this.statsData = { total: this.totalCount, normal: 0, disabled: 0 };
            Object.values(this.data).forEach(credInfo => {
                if (credInfo.status.disabled) {
                    this.statsData.disabled++;
                } else {
                    this.statsData.normal++;
                }
            });
        },

        // 更新统计显示
        updateStatsDisplay() {
            document.getElementById(this.getElementId('StatTotal')).textContent = this.statsData.total;
            document.getElementById(this.getElementId('StatNormal')).textContent = this.statsData.normal;
            document.getElementById(this.getElementId('StatDisabled')).textContent = this.statsData.disabled;
        },

        // 渲染凭证列表
        renderList() {
            const list = document.getElementById(this.getElementId('CredsList'));
            list.innerHTML = '';

            const entries = Object.entries(this.filteredData);

            if (entries.length === 0) {
                const msg = this.totalCount === 0 ? '暂无凭证文件' : '当前筛选条件下暂无数据';
                list.innerHTML = `<p style="text-align: center; color: #666;">${msg}</p>`;
                document.getElementById(this.getElementId('PaginationContainer')).style.display = 'none';
                return;
            }

            entries.forEach(([, credInfo]) => {
                list.appendChild(createCredCard(credInfo, this));
            });

            document.getElementById(this.getElementId('PaginationContainer')).style.display =
                this.getTotalPages() > 1 ? 'flex' : 'none';
            this.updateBatchControls();
        },

        // 获取总页数
        getTotalPages() {
            return Math.ceil(this.totalCount / this.pageSize);
        },

        // 更新分页信息
        updatePagination() {
            const totalPages = this.getTotalPages();
            const startItem = (this.currentPage - 1) * this.pageSize + 1;
            const endItem = Math.min(this.currentPage * this.pageSize, this.totalCount);

            document.getElementById(this.getElementId('PaginationInfo')).textContent =
                `第 ${this.currentPage} 页，共 ${totalPages} 页 (显示 ${startItem}-${endItem}，共 ${this.totalCount} 项)`;

            document.getElementById(this.getElementId('PrevPageBtn')).disabled = this.currentPage <= 1;
            document.getElementById(this.getElementId('NextPageBtn')).disabled = this.currentPage >= totalPages;
        },

        // 切换页面
        changePage(direction) {
            const newPage = this.currentPage + direction;
            if (newPage >= 1 && newPage <= this.getTotalPages()) {
                this.currentPage = newPage;
                this.refresh();
            }
        },

        // 改变每页大小
        changePageSize() {
            this.pageSize = parseInt(document.getElementById(this.getElementId('PageSizeSelect')).value);
            this.currentPage = 1;
            this.refresh();
        },

        // 应用状态筛选
        applyStatusFilter() {
            this.currentStatusFilter = document.getElementById(this.getElementId('StatusFilter')).value;
            this.currentPage = 1;
            this.refresh();
        },

        // 更新批量控件
        updateBatchControls() {
            const selectedCount = this.selectedFiles.size;
            document.getElementById(this.getElementId('SelectedCount')).textContent = `已选择 ${selectedCount} 项`;

            const batchBtns = ['Enable', 'Disable', 'Delete'].map(action =>
                document.getElementById(this.getElementId(`Batch${action}Btn`))
            );
            batchBtns.forEach(btn => btn && (btn.disabled = selectedCount === 0));

            const selectAllCheckbox = document.getElementById(this.getElementId('SelectAllCheckbox'));
            if (!selectAllCheckbox) return;

            const checkboxes = document.querySelectorAll(`.${this.getElementId('file-checkbox')}`);
            const currentPageSelectedCount = Array.from(checkboxes)
                .filter(cb => this.selectedFiles.has(cb.getAttribute('data-filename'))).length;

            if (currentPageSelectedCount === 0) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = false;
            } else if (currentPageSelectedCount === checkboxes.length) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = true;
            } else {
                selectAllCheckbox.indeterminate = true;
            }

            checkboxes.forEach(cb => {
                cb.checked = this.selectedFiles.has(cb.getAttribute('data-filename'));
            });
        },

        // 凭证操作
        async action(filename, action) {
            try {
                const response = await fetch(this.getEndpoint('action'), {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ filename, action })
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(data.message || `操作成功: ${action}`, 'success');
                    await this.refresh();
                } else {
                    showStatus(`操作失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        },

        // 批量操作
        async batchAction(action) {
            const selectedFiles = Array.from(this.selectedFiles);

            if (selectedFiles.length === 0) {
                showStatus('请先选择要操作的文件', 'error');
                return;
            }

            const actionNames = { enable: '启用', disable: '禁用', delete: '删除' };
            const confirmMsg = action === 'delete'
                ? `确定要删除选中的 ${selectedFiles.length} 个文件吗？\n注意：此操作不可恢复！`
                : `确定要${actionNames[action]}选中的 ${selectedFiles.length} 个文件吗？`;

            if (!confirm(confirmMsg)) return;

            try {
                showStatus(`正在执行批量${actionNames[action]}操作...`, 'info');

                const response = await fetch(this.getEndpoint('batchAction'), {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ action, filenames: selectedFiles })
                });

                const data = await response.json();

                if (response.ok) {
                    const successCount = data.success_count || data.succeeded;
                    showStatus(`批量操作完成：成功处理 ${successCount}/${selectedFiles.length} 个文件`, 'success');
                    this.selectedFiles.clear();
                    this.updateBatchControls();
                    await this.refresh();
                } else {
                    showStatus(`批量操作失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`批量操作网络错误: ${error.message}`, 'error');
            }
        }
    };
}

// =====================================================================
// 文件上传管理器工厂
// =====================================================================
function createUploadManager(type) {
    const isAntigravity = type === 'antigravity';
    const endpoint = isAntigravity ? './antigravity/upload' : './auth/upload';

    return {
        type: type,
        selectedFiles: [],

        getElementId: (suffix) => {
            // 普通上传的ID首字母小写,如 fileList
            // Antigravity的ID是 antigravity + 首字母大写,如 antigravityFileList
            if (isAntigravity) {
                return 'antigravity' + suffix.charAt(0).toUpperCase() + suffix.slice(1);
            }
            return suffix.charAt(0).toLowerCase() + suffix.slice(1);
        },

        handleFileSelect(event) {
            this.addFiles(Array.from(event.target.files));
        },

        addFiles(files) {
            files.forEach(file => {
                const isValid = file.type === 'application/json' || file.name.endsWith('.json') ||
                               file.type === 'application/zip' || file.name.endsWith('.zip');

                if (isValid) {
                    if (!this.selectedFiles.find(f => f.name === file.name && f.size === file.size)) {
                        this.selectedFiles.push(file);
                    }
                } else {
                    showStatus(`文件 ${file.name} 格式不支持，只支持JSON和ZIP文件`, 'error');
                }
            });
            this.updateFileList();
        },

        updateFileList() {
            const list = document.getElementById(this.getElementId('FileList'));
            const section = document.getElementById(this.getElementId('FileListSection'));

            if (!list || !section) {
                console.warn('File list elements not found:', this.getElementId('FileList'));
                return;
            }

            if (this.selectedFiles.length === 0) {
                section.classList.add('hidden');
                return;
            }

            section.classList.remove('hidden');
            list.innerHTML = '';

            this.selectedFiles.forEach((file, index) => {
                const isZip = file.name.endsWith('.zip');
                const fileIcon = isZip ? '📦' : '📄';
                const fileType = isZip ? ' (ZIP压缩包)' : ' (JSON文件)';

                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                fileItem.innerHTML = `
                    <div>
                        <span class="file-name">${fileIcon} ${file.name}</span>
                        <span class="file-size">(${formatFileSize(file.size)}${fileType})</span>
                    </div>
                    <button class="remove-btn" onclick="${isAntigravity ? 'removeAntigravityFile' : 'removeFile'}(${index})">删除</button>
                `;
                list.appendChild(fileItem);
            });
        },

        removeFile(index) {
            this.selectedFiles.splice(index, 1);
            this.updateFileList();
        },

        clearFiles() {
            this.selectedFiles = [];
            this.updateFileList();
        },

        async upload() {
            if (this.selectedFiles.length === 0) {
                showStatus('请选择要上传的文件', 'error');
                return;
            }

            const progressSection = document.getElementById(this.getElementId('UploadProgressSection'));
            const progressFill = document.getElementById(this.getElementId('ProgressFill'));
            const progressText = document.getElementById(this.getElementId('ProgressText'));

            progressSection.classList.remove('hidden');

            const formData = new FormData();
            this.selectedFiles.forEach(file => formData.append('files', file));

            if (this.selectedFiles.some(f => f.name.endsWith('.zip'))) {
                showStatus('正在上传并解压ZIP文件...', 'info');
            }

            try {
                const xhr = new XMLHttpRequest();
                xhr.timeout = 300000; // 5分钟

                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percent = (event.loaded / event.total) * 100;
                        progressFill.style.width = percent + '%';
                        progressText.textContent = Math.round(percent) + '%';
                    }
                };

                xhr.onload = () => {
                    if (xhr.status === 200) {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            showStatus(`成功上传 ${data.uploaded_count} 个${isAntigravity ? 'Antigravity' : ''}文件`, 'success');
                            this.clearFiles();
                            progressSection.classList.add('hidden');
                        } catch (e) {
                            showStatus('上传失败: 服务器响应格式错误', 'error');
                        }
                    } else {
                        try {
                            const error = JSON.parse(xhr.responseText);
                            showStatus(`上传失败: ${error.detail || error.error || '未知错误'}`, 'error');
                        } catch (e) {
                            showStatus(`上传失败: HTTP ${xhr.status}`, 'error');
                        }
                    }
                };

                xhr.onerror = () => {
                    showStatus(`上传失败：连接中断 - 可能原因：文件过多(${this.selectedFiles.length}个)或网络不稳定。建议分批上传。`, 'error');
                    progressSection.classList.add('hidden');
                };

                xhr.ontimeout = () => {
                    showStatus('上传失败：请求超时 - 文件处理时间过长，请减少文件数量或检查网络连接', 'error');
                    progressSection.classList.add('hidden');
                };

                xhr.open('POST', endpoint);
                xhr.setRequestHeader('Authorization', `Bearer ${AppState.authToken}`);
                xhr.send(formData);
            } catch (error) {
                showStatus(`上传失败: ${error.message}`, 'error');
            }
        }
    };
}

// =====================================================================
// 工具函数
// =====================================================================
function showStatus(message, type = 'info') {
    const statusSection = document.getElementById('statusSection');
    if (statusSection) {
        statusSection.innerHTML = `<div class="status ${type}">${message}</div>`;
    } else {
        alert(message);
    }
}

function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.authToken}`
    };
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return Math.round(bytes / (1024 * 1024)) + ' MB';
}

function formatCooldownTime(remainingSeconds) {
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

// =====================================================================
// 凭证卡片创建（通用）
// =====================================================================
function createCredCard(credInfo, manager) {
    const div = document.createElement('div');
    const { status, filename } = credInfo;
    const isAntigravity = manager.type === 'antigravity';

    // 卡片样式
    div.className = status.disabled ? 'cred-card disabled' : 'cred-card';

    // 状态徽章
    let statusBadges = '';
    statusBadges += status.disabled
        ? '<span class="status-badge disabled">已禁用</span>'
        : '<span class="status-badge enabled">已启用</span>';

    if (status.error_codes && status.error_codes.length > 0) {
        statusBadges += `<span class="error-codes">错误码: ${status.error_codes.join(', ')}</span>`;
        const autoBan = status.error_codes.filter(c => c === 400 || c === 403);
        if (autoBan.length > 0 && status.disabled) {
            statusBadges += '<span class="status-badge" style="background-color: #e74c3c; color: white;">AUTO_BAN</span>';
        }
    } else {
        statusBadges += '<span class="status-badge" style="background-color: #28a745; color: white;">无错误</span>';
    }

    // 模型级冷却状态
    if (credInfo.model_cooldowns && Object.keys(credInfo.model_cooldowns).length > 0) {
        const currentTime = Date.now() / 1000;
        const activeCooldowns = Object.entries(credInfo.model_cooldowns)
            .filter(([, until]) => until > currentTime)
            .map(([model, until]) => {
                const remaining = Math.max(0, Math.floor(until - currentTime));
                const shortModel = model.replace('gemini-', '').replace('-exp', '')
                    .replace('2.0-', '2-').replace('1.5-', '1.5-');
                return {
                    model: shortModel,
                    time: formatCooldownTime(remaining).replace(/s$/, '').replace(/ /g, ''),
                    fullModel: model
                };
            });

        if (activeCooldowns.length > 0) {
            activeCooldowns.slice(0, 2).forEach(item => {
                statusBadges += `<span class="cooldown-badge" style="background-color: #17a2b8;" title="模型: ${item.fullModel}">🔧 ${item.model}: ${item.time}</span>`;
            });
            if (activeCooldowns.length > 2) {
                const remaining = activeCooldowns.length - 2;
                const remainingModels = activeCooldowns.slice(2).map(i => `${i.fullModel}: ${i.time}`).join('\n');
                statusBadges += `<span class="cooldown-badge" style="background-color: #17a2b8;" title="其他模型:\n${remainingModels}">+${remaining}</span>`;
            }
        }
    }

    // 路径ID
    const pathId = (isAntigravity ? 'ag_' : '') + btoa(encodeURIComponent(filename)).replace(/[+/=]/g, '_');

    // 操作按钮
    const actionButtons = `
        ${status.disabled
            ? `<button class="cred-btn enable" data-filename="${filename}" data-action="enable">启用</button>`
            : `<button class="cred-btn disable" data-filename="${filename}" data-action="disable">禁用</button>`
        }
        <button class="cred-btn view" onclick="toggle${isAntigravity ? 'Antigravity' : ''}CredDetails('${pathId}')">查看内容</button>
        <button class="cred-btn download" onclick="download${isAntigravity ? 'Antigravity' : ''}Cred('${filename}')">下载</button>
        <button class="cred-btn email" onclick="fetch${isAntigravity ? 'Antigravity' : ''}UserEmail('${filename}')">查看账号邮箱</button>
        <button class="cred-btn delete" data-filename="${filename}" data-action="delete">删除</button>
    `;

    // 邮箱信息
    const emailInfo = credInfo.user_email
        ? `<div class="cred-email" style="font-size: 12px; color: #666; margin-top: 2px;">${credInfo.user_email}</div>`
        : '<div class="cred-email" style="font-size: 12px; color: #999; margin-top: 2px; font-style: italic;">未获取邮箱</div>';

    const checkboxClass = manager.getElementId('file-checkbox');

    div.innerHTML = `
        <div class="cred-header">
            <div style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" class="${checkboxClass}" data-filename="${filename}" onchange="toggle${isAntigravity ? 'Antigravity' : ''}FileSelection('${filename}')">
                <div>
                    <div class="cred-filename">${filename}</div>
                    ${emailInfo}
                </div>
            </div>
            <div class="cred-status">${statusBadges}</div>
        </div>
        <div class="cred-actions">${actionButtons}</div>
        <div class="cred-details" id="details-${pathId}">
            <div class="cred-content" data-filename="${filename}" data-loaded="false">点击"查看内容"按钮加载文件详情...</div>
        </div>
    `;

    // 添加事件监听
    div.querySelectorAll('[data-filename][data-action]').forEach(button => {
        button.addEventListener('click', function() {
            const fn = this.getAttribute('data-filename');
            const action = this.getAttribute('data-action');
            if (action === 'delete') {
                if (confirm(`确定要删除${isAntigravity ? ' Antigravity ' : ''}凭证文件吗？\n${fn}`)) {
                    manager.action(fn, action);
                }
            } else {
                manager.action(fn, action);
            }
        });
    });

    return div;
}

// =====================================================================
// 凭证详情切换
// =====================================================================
async function toggleCredDetails(pathId) {
    await toggleCredDetailsCommon(pathId, AppState.creds);
}

async function toggleAntigravityCredDetails(pathId) {
    await toggleCredDetailsCommon(pathId, AppState.antigravityCreds);
}

async function toggleCredDetailsCommon(pathId, manager) {
    const details = document.getElementById('details-' + pathId);
    if (!details) return;

    const isShowing = details.classList.toggle('show');

    if (isShowing) {
        const contentDiv = details.querySelector('.cred-content');
        const filename = contentDiv.getAttribute('data-filename');
        const loaded = contentDiv.getAttribute('data-loaded');

        if (loaded === 'false' && filename) {
            contentDiv.textContent = '正在加载文件内容...';

            try {
                const endpoint = manager.type === 'antigravity'
                    ? `./antigravity/creds/download/${encodeURIComponent(filename)}`
                    : `./creds/detail/${encodeURIComponent(filename)}`;

                const response = await fetch(endpoint, { headers: getAuthHeaders() });

                if (manager.type === 'antigravity') {
                    if (response.ok) {
                        const text = await response.text();
                        contentDiv.textContent = text;
                        contentDiv.setAttribute('data-loaded', 'true');
                    } else {
                        contentDiv.textContent = '加载失败';
                    }
                } else {
                    const data = await response.json();
                    if (response.ok && data.content) {
                        contentDiv.textContent = JSON.stringify(data.content, null, 2);
                        contentDiv.setAttribute('data-loaded', 'true');
                    } else {
                        contentDiv.textContent = '无法加载文件内容: ' + (data.error || data.detail || '未知错误');
                    }
                }
            } catch (error) {
                contentDiv.textContent = '加载文件内容失败: ' + error.message;
            }
        }
    }
}

// =====================================================================
// 登录相关函数
// =====================================================================
async function login() {
    const password = document.getElementById('loginPassword').value;

    if (!password) {
        showStatus('请输入密码', 'error');
        return;
    }

    try {
        const response = await fetch('./auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (response.ok) {
            AppState.authToken = data.token;
            localStorage.setItem('gcli2api_auth_token', AppState.authToken);
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('mainSection').classList.remove('hidden');
            showStatus('登录成功', 'success');
        } else {
            showStatus(`登录失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

async function autoLogin() {
    const savedToken = localStorage.getItem('gcli2api_auth_token');
    if (!savedToken) return false;

    AppState.authToken = savedToken;

    try {
        const response = await fetch('./config/get', {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AppState.authToken}`
            }
        });

        if (response.ok) {
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('mainSection').classList.remove('hidden');
            showStatus('自动登录成功', 'success');
            return true;
        } else if (response.status === 401) {
            localStorage.removeItem('gcli2api_auth_token');
            AppState.authToken = '';
            return false;
        }
        return false;
    } catch (error) {
        return false;
    }
}

function logout() {
    localStorage.removeItem('gcli2api_auth_token');
    AppState.authToken = '';
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('mainSection').classList.add('hidden');
    showStatus('已退出登录', 'info');
    const passwordInput = document.getElementById('loginPassword');
    if (passwordInput) passwordInput.value = '';
}

function handlePasswordEnter(event) {
    if (event.key === 'Enter') login();
}

// =====================================================================
// 标签页切换
// =====================================================================
function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    event.target.classList.add('active');
    document.getElementById(tabName + 'Tab').classList.add('active');

    if (tabName === 'manage') AppState.creds.refresh();
    if (tabName === 'antigravity-manage') AppState.antigravityCreds.refresh();
    if (tabName === 'config') loadConfig();
    if (tabName === 'logs') connectWebSocket();
}

// =====================================================================
// OAuth认证相关函数
// =====================================================================
async function startAuth() {
    const projectId = document.getElementById('projectId').value.trim();
    AppState.currentProjectId = projectId || null;

    const btn = document.getElementById('getAuthBtn');
    btn.disabled = true;
    btn.textContent = '正在获取认证链接...';

    try {
        const requestBody = projectId ? { project_id: projectId } : {};
        showStatus(projectId ? '使用指定的项目ID生成认证链接...' : '将尝试自动检测项目ID，正在生成认证链接...', 'info');

        const response = await fetch('./auth/start', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('authUrl').href = data.auth_url;
            document.getElementById('authUrl').textContent = data.auth_url;
            document.getElementById('authUrlSection').classList.remove('hidden');

            const msg = data.auto_project_detection
                ? '认证链接已生成（将在认证完成后自动检测项目ID），请点击链接完成授权'
                : `认证链接已生成（项目ID: ${data.detected_project_id}），请点击链接完成授权`;
            showStatus(msg, 'info');
            AppState.authInProgress = true;
        } else {
            showStatus(`错误: ${data.error || '获取认证链接失败'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '获取认证链接';
    }
}

async function getCredentials() {
    if (!AppState.authInProgress) {
        showStatus('请先获取认证链接并完成授权', 'error');
        return;
    }

    const btn = document.getElementById('getCredsBtn');
    btn.disabled = true;
    btn.textContent = '等待OAuth回调中...';

    try {
        showStatus('正在等待OAuth回调，这可能需要一些时间...', 'info');

        const requestBody = AppState.currentProjectId ? { project_id: AppState.currentProjectId } : {};

        const response = await fetch('./auth/callback', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('credentialsContent').textContent = JSON.stringify(data.credentials, null, 2);

            const msg = data.auto_detected_project
                ? `✅ 认证成功！项目ID已自动检测为: ${data.credentials.project_id}，文件已保存到: ${data.file_path}`
                : `✅ 认证成功！文件已保存到: ${data.file_path}`;
            showStatus(msg, 'success');

            document.getElementById('credentialsSection').classList.remove('hidden');
            AppState.authInProgress = false;
        } else if (data.requires_project_selection && data.available_projects) {
            let projectOptions = "请选择一个项目：\n\n";
            data.available_projects.forEach((project, index) => {
                projectOptions += `${index + 1}. ${project.name} (${project.project_id})\n`;
            });
            projectOptions += `\n请输入序号 (1-${data.available_projects.length}):`;

            const selection = prompt(projectOptions);
            const projectIndex = parseInt(selection) - 1;

            if (projectIndex >= 0 && projectIndex < data.available_projects.length) {
                AppState.currentProjectId = data.available_projects[projectIndex].project_id;
                btn.textContent = '重新尝试获取认证文件';
                showStatus(`使用选择的项目重新尝试...`, 'info');
                setTimeout(() => getCredentials(), 1000);
                return;
            } else {
                showStatus('无效的选择，请重新开始认证', 'error');
            }
        } else if (data.requires_manual_project_id) {
            const userProjectId = prompt('无法自动检测项目ID，请手动输入您的Google Cloud项目ID:');
            if (userProjectId && userProjectId.trim()) {
                AppState.currentProjectId = userProjectId.trim();
                btn.textContent = '重新尝试获取认证文件';
                showStatus('使用手动输入的项目ID重新尝试...', 'info');
                setTimeout(() => getCredentials(), 1000);
                return;
            } else {
                showStatus('需要项目ID才能完成认证，请重新开始并输入正确的项目ID', 'error');
            }
        } else {
            showStatus(`❌ 错误: ${data.error || '获取认证文件失败'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '获取认证文件';
    }
}

// =====================================================================
// Antigravity 认证相关函数
// =====================================================================
async function startAntigravityAuth() {
    const btn = document.getElementById('getAntigravityAuthBtn');
    btn.disabled = true;
    btn.textContent = '生成认证链接中...';

    try {
        showStatus('正在生成 Antigravity 认证链接...', 'info');

        const response = await fetch('./auth/start', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ use_antigravity: true })
        });

        const data = await response.json();

        if (response.ok) {
            AppState.antigravityAuthState = data.state;
            AppState.antigravityAuthInProgress = true;

            const authUrlLink = document.getElementById('antigravityAuthUrl');
            authUrlLink.href = data.auth_url;
            authUrlLink.textContent = data.auth_url;
            document.getElementById('antigravityAuthUrlSection').classList.remove('hidden');

            showStatus('✅ Antigravity 认证链接已生成！请点击链接完成授权', 'success');
        } else {
            showStatus(`❌ 错误: ${data.error || '生成认证链接失败'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '获取 Antigravity 认证链接';
    }
}

async function getAntigravityCredentials() {
    if (!AppState.antigravityAuthInProgress) {
        showStatus('请先获取 Antigravity 认证链接并完成授权', 'error');
        return;
    }

    const btn = document.getElementById('getAntigravityCredsBtn');
    btn.disabled = true;
    btn.textContent = '等待OAuth回调中...';

    try {
        showStatus('正在等待 Antigravity OAuth回调...', 'info');

        const response = await fetch('./auth/callback', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ use_antigravity: true })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('antigravityCredsContent').textContent = JSON.stringify(data.credentials, null, 2);
            document.getElementById('antigravityCredsSection').classList.remove('hidden');
            AppState.antigravityAuthInProgress = false;
            showStatus(`✅ Antigravity 认证成功！文件已保存到: ${data.file_path}`, 'success');
        } else {
            showStatus(`❌ 错误: ${data.error || '获取认证文件失败'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '获取 Antigravity 凭证';
    }
}

function downloadAntigravityCredentials() {
    const content = document.getElementById('antigravityCredsContent').textContent;
    const blob = new Blob([content], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `antigravity-credential-${Date.now()}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// =====================================================================
// 回调URL处理
// =====================================================================
function toggleProjectIdSection() {
    const section = document.getElementById('projectIdSection');
    const icon = document.getElementById('projectIdToggleIcon');

    if (section.style.display === 'none') {
        section.style.display = 'block';
        icon.style.transform = 'rotate(90deg)';
        icon.textContent = '▼';
    } else {
        section.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '▶';
    }
}

function toggleCallbackUrlSection() {
    const section = document.getElementById('callbackUrlSection');
    const icon = document.getElementById('callbackUrlToggleIcon');

    if (section.style.display === 'none') {
        section.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
        icon.textContent = '▲';
    } else {
        section.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '▼';
    }
}

function toggleAntigravityCallbackUrlSection() {
    const section = document.getElementById('antigravityCallbackUrlSection');
    const icon = document.getElementById('antigravityCallbackUrlToggleIcon');

    if (section.style.display === 'none') {
        section.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
        icon.textContent = '▲';
    } else {
        section.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '▼';
    }
}

async function processCallbackUrl() {
    const callbackUrl = document.getElementById('callbackUrlInput').value.trim();

    if (!callbackUrl) {
        showStatus('请输入回调URL', 'error');
        return;
    }

    if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
        showStatus('请输入有效的URL（以http://或https://开头）', 'error');
        return;
    }

    if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
        showStatus('❌ 这不是有效的回调URL！请确保：\n1. 已完成Google OAuth授权\n2. 复制的是浏览器地址栏的完整URL\n3. URL包含code和state参数', 'error');
        return;
    }

    showStatus('正在从回调URL获取凭证...', 'info');

    try {
        const projectId = document.getElementById('projectId')?.value.trim() || null;

        const response = await fetch('./auth/callback-url', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ callback_url: callbackUrl, project_id: projectId })
        });

        const result = await response.json();

        if (result.credentials) {
            showStatus(result.message || '从回调URL获取凭证成功！', 'success');
            document.getElementById('credentialsContent').innerHTML = '<pre>' + JSON.stringify(result.credentials, null, 2) + '</pre>';
            document.getElementById('credentialsSection').classList.remove('hidden');
        } else if (result.requires_manual_project_id) {
            showStatus('需要手动指定项目ID，请在高级选项中填入Google Cloud项目ID后重试', 'error');
        } else if (result.requires_project_selection) {
            let msg = '<br><strong>可用项目：</strong><br>';
            result.available_projects.forEach(p => {
                msg += `• ${p.name} (ID: ${p.project_id})<br>`;
            });
            showStatus('检测到多个项目，请在高级选项中指定项目ID：' + msg, 'error');
        } else {
            showStatus(result.error || '从回调URL获取凭证失败', 'error');
        }

        document.getElementById('callbackUrlInput').value = '';
    } catch (error) {
        showStatus(`从回调URL获取凭证失败: ${error.message}`, 'error');
    }
}

async function processAntigravityCallbackUrl() {
    const callbackUrl = document.getElementById('antigravityCallbackUrlInput').value.trim();

    if (!callbackUrl) {
        showStatus('请输入回调URL', 'error');
        return;
    }

    if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
        showStatus('请输入有效的URL（以http://或https://开头）', 'error');
        return;
    }

    if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
        showStatus('❌ 这不是有效的回调URL！请确保包含code和state参数', 'error');
        return;
    }

    showStatus('正在从回调URL获取 Antigravity 凭证...', 'info');

    try {
        const response = await fetch('./auth/callback-url', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ callback_url: callbackUrl, use_antigravity: true })
        });

        const result = await response.json();

        if (result.credentials) {
            showStatus(result.message || '从回调URL获取 Antigravity 凭证成功！', 'success');
            document.getElementById('antigravityCredsContent').textContent = JSON.stringify(result.credentials, null, 2);
            document.getElementById('antigravityCredsSection').classList.remove('hidden');
        } else {
            showStatus(result.error || '从回调URL获取 Antigravity 凭证失败', 'error');
        }

        document.getElementById('antigravityCallbackUrlInput').value = '';
    } catch (error) {
        showStatus(`从回调URL获取 Antigravity 凭证失败: ${error.message}`, 'error');
    }
}

// =====================================================================
// 全局兼容函数（供HTML调用）
// =====================================================================
// 普通凭证管理
function refreshCredsStatus() { AppState.creds.refresh(); }
function applyStatusFilter() { AppState.creds.applyStatusFilter(); }
function changePage(direction) { AppState.creds.changePage(direction); }
function changePageSize() { AppState.creds.changePageSize(); }
function toggleFileSelection(filename) {
    if (AppState.creds.selectedFiles.has(filename)) {
        AppState.creds.selectedFiles.delete(filename);
    } else {
        AppState.creds.selectedFiles.add(filename);
    }
    AppState.creds.updateBatchControls();
}
function toggleSelectAll() {
    const checkbox = document.getElementById('selectAllCheckbox');
    const checkboxes = document.querySelectorAll('.file-checkbox');

    if (checkbox.checked) {
        checkboxes.forEach(cb => AppState.creds.selectedFiles.add(cb.getAttribute('data-filename')));
    } else {
        AppState.creds.selectedFiles.clear();
    }
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
    AppState.creds.updateBatchControls();
}
function batchAction(action) { AppState.creds.batchAction(action); }
function downloadCred(filename) {
    fetch(`./creds/download/${filename}`, { headers: { 'Authorization': `Bearer ${AppState.authToken}` } })
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus(`已下载文件: ${filename}`, 'success');
        })
        .catch(() => showStatus(`下载失败: ${filename}`, 'error'));
}
async function downloadAllCreds() {
    try {
        const response = await fetch('./creds/download-all', {
            headers: { 'Authorization': `Bearer ${AppState.authToken}` }
        });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'credentials.zip';
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus('已下载所有凭证文件', 'success');
        }
    } catch (error) {
        showStatus(`打包下载失败: ${error.message}`, 'error');
    }
}

// Antigravity凭证管理
function refreshAntigravityCredsList() { AppState.antigravityCreds.refresh(); }
function applyAntigravityStatusFilter() { AppState.antigravityCreds.applyStatusFilter(); }
function changeAntigravityPage(direction) { AppState.antigravityCreds.changePage(direction); }
function changeAntigravityPageSize() { AppState.antigravityCreds.changePageSize(); }
function toggleAntigravityFileSelection(filename) {
    if (AppState.antigravityCreds.selectedFiles.has(filename)) {
        AppState.antigravityCreds.selectedFiles.delete(filename);
    } else {
        AppState.antigravityCreds.selectedFiles.add(filename);
    }
    AppState.antigravityCreds.updateBatchControls();
}
function toggleSelectAllAntigravity() {
    const checkbox = document.getElementById('selectAllAntigravityCheckbox');
    const checkboxes = document.querySelectorAll('.antigravityFile-checkbox');

    if (checkbox.checked) {
        checkboxes.forEach(cb => AppState.antigravityCreds.selectedFiles.add(cb.getAttribute('data-filename')));
    } else {
        AppState.antigravityCreds.selectedFiles.clear();
    }
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
    AppState.antigravityCreds.updateBatchControls();
}
function batchAntigravityAction(action) { AppState.antigravityCreds.batchAction(action); }
function downloadAntigravityCred(filename) {
    fetch(`./antigravity/creds/download/${filename}`, { headers: getAuthHeaders() })
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus(`✅ 已下载: ${filename}`, 'success');
        })
        .catch(() => showStatus(`下载失败: ${filename}`, 'error'));
}
function deleteAntigravityCred(filename) {
    if (confirm(`确定要删除 ${filename} 吗？`)) {
        AppState.antigravityCreds.action(filename, 'delete');
    }
}
async function downloadAllAntigravityCreds() {
    try {
        const response = await fetch('./antigravity/creds/download-all', { headers: getAuthHeaders() });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `antigravity_credentials_${Date.now()}.zip`;
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus('✅ 所有Antigravity凭证已打包下载', 'success');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

// 文件上传
function handleFileSelect(event) { AppState.uploadFiles.handleFileSelect(event); }
function removeFile(index) { AppState.uploadFiles.removeFile(index); }
function clearFiles() { AppState.uploadFiles.clearFiles(); }
function uploadFiles() { AppState.uploadFiles.upload(); }

function handleAntigravityFileSelect(event) { AppState.antigravityUploadFiles.handleFileSelect(event); }
function handleAntigravityFileDrop(event) {
    event.preventDefault();
    event.currentTarget.style.borderColor = '#007bff';
    event.currentTarget.style.backgroundColor = '#f8f9fa';
    AppState.antigravityUploadFiles.addFiles(Array.from(event.dataTransfer.files));
}
function removeAntigravityFile(index) { AppState.antigravityUploadFiles.removeFile(index); }
function clearAntigravityFiles() { AppState.antigravityUploadFiles.clearFiles(); }
function uploadAntigravityFiles() { AppState.antigravityUploadFiles.upload(); }

// 邮箱相关
async function fetchUserEmail(filename) {
    try {
        showStatus('正在获取用户邮箱...', 'info');
        const response = await fetch(`./creds/fetch-email/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok && data.user_email) {
            showStatus(`成功获取邮箱: ${data.user_email}`, 'success');
            await AppState.creds.refresh();
        } else {
            showStatus(data.message || '无法获取用户邮箱', 'error');
        }
    } catch (error) {
        showStatus(`获取邮箱失败: ${error.message}`, 'error');
    }
}

async function fetchAntigravityUserEmail(filename) {
    try {
        showStatus('正在获取用户邮箱...', 'info');
        const response = await fetch(`./antigravity/creds/fetch-email/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok && data.user_email) {
            showStatus(`成功获取邮箱: ${data.user_email}`, 'success');
            await AppState.antigravityCreds.refresh();
        } else {
            showStatus(data.message || '无法获取用户邮箱', 'error');
        }
    } catch (error) {
        showStatus(`获取邮箱失败: ${error.message}`, 'error');
    }
}

async function refreshAllEmails() {
    if (!confirm('确定要刷新所有凭证的用户邮箱吗？这可能需要一些时间。')) return;

    try {
        showStatus('正在刷新所有用户邮箱...', 'info');
        const response = await fetch('./creds/refresh-all-emails', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            showStatus(`邮箱刷新完成：成功获取 ${data.success_count}/${data.total_count} 个邮箱地址`, 'success');
            await AppState.creds.refresh();
        } else {
            showStatus(data.message || '邮箱刷新失败', 'error');
        }
    } catch (error) {
        showStatus(`邮箱刷新网络错误: ${error.message}`, 'error');
    }
}

async function refreshAllAntigravityEmails() {
    if (!confirm('确定要刷新所有Antigravity凭证的用户邮箱吗？这可能需要一些时间。')) return;

    try {
        showStatus('正在刷新所有用户邮箱...', 'info');
        const response = await fetch('./antigravity/creds/refresh-all-emails', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            showStatus(`邮箱刷新完成：成功获取 ${data.success_count}/${data.total_count} 个邮箱地址`, 'success');
            await AppState.antigravityCreds.refresh();
        } else {
            showStatus(data.message || '邮箱刷新失败', 'error');
        }
    } catch (error) {
        showStatus(`邮箱刷新网络错误: ${error.message}`, 'error');
    }
}

// =====================================================================
// WebSocket日志相关
// =====================================================================
function connectWebSocket() {
    if (AppState.logWebSocket && AppState.logWebSocket.readyState === WebSocket.OPEN) {
        showStatus('WebSocket已经连接', 'info');
        return;
    }

    try {
        const wsPath = new URL('./auth/logs/stream', window.location.href).href;
        const wsUrl = wsPath.replace(/^http/, 'ws');

        document.getElementById('connectionStatusText').textContent = '连接中...';
        document.getElementById('logConnectionStatus').className = 'status info';

        AppState.logWebSocket = new WebSocket(wsUrl);

        AppState.logWebSocket.onopen = () => {
            document.getElementById('connectionStatusText').textContent = '已连接';
            document.getElementById('logConnectionStatus').className = 'status success';
            showStatus('日志流连接成功', 'success');
            clearLogsDisplay();
        };

        AppState.logWebSocket.onmessage = (event) => {
            const logLine = event.data;
            if (logLine.trim()) {
                AppState.allLogs.push(logLine);
                if (AppState.allLogs.length > 1000) {
                    AppState.allLogs = AppState.allLogs.slice(-1000);
                }
                filterLogs();
                if (document.getElementById('autoScroll').checked) {
                    const logContainer = document.getElementById('logContainer');
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
            }
        };

        AppState.logWebSocket.onclose = () => {
            document.getElementById('connectionStatusText').textContent = '连接断开';
            document.getElementById('logConnectionStatus').className = 'status error';
            showStatus('日志流连接断开', 'info');
        };

        AppState.logWebSocket.onerror = (error) => {
            document.getElementById('connectionStatusText').textContent = '连接错误';
            document.getElementById('logConnectionStatus').className = 'status error';
            showStatus('日志流连接错误: ' + error, 'error');
        };
    } catch (error) {
        showStatus('创建WebSocket连接失败: ' + error.message, 'error');
        document.getElementById('connectionStatusText').textContent = '连接失败';
        document.getElementById('logConnectionStatus').className = 'status error';
    }
}

function disconnectWebSocket() {
    if (AppState.logWebSocket) {
        AppState.logWebSocket.close();
        AppState.logWebSocket = null;
        document.getElementById('connectionStatusText').textContent = '未连接';
        document.getElementById('logConnectionStatus').className = 'status info';
        showStatus('日志流连接已断开', 'info');
    }
}

function clearLogsDisplay() {
    AppState.allLogs = [];
    AppState.filteredLogs = [];
    document.getElementById('logContent').textContent = '日志已清空，等待新日志...';
}

async function downloadLogs() {
    try {
        const response = await fetch('./auth/logs/download', { headers: getAuthHeaders() });

        if (response.ok) {
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'gcli2api_logs.txt';
            if (contentDisposition) {
                const match = contentDisposition.match(/filename=(.+)/);
                if (match) filename = match[1];
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);

            showStatus(`日志文件下载成功: ${filename}`, 'success');
        } else {
            const data = await response.json();
            showStatus(`下载日志失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`下载日志时网络错误: ${error.message}`, 'error');
    }
}

async function clearLogs() {
    try {
        const response = await fetch('./auth/logs/clear', {
            method: 'POST',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            clearLogsDisplay();
            showStatus(data.message, 'success');
        } else {
            showStatus(`清空日志失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        clearLogsDisplay();
        showStatus(`清空日志时网络错误: ${error.message}`, 'error');
    }
}

function filterLogs() {
    const filter = document.getElementById('logLevelFilter').value;
    AppState.currentLogFilter = filter;

    if (filter === 'all') {
        AppState.filteredLogs = [...AppState.allLogs];
    } else {
        AppState.filteredLogs = AppState.allLogs.filter(log => log.toUpperCase().includes(filter));
    }

    displayLogs();
}

function displayLogs() {
    const logContent = document.getElementById('logContent');
    if (AppState.filteredLogs.length === 0) {
        logContent.textContent = AppState.currentLogFilter === 'all' ?
            '暂无日志...' : `暂无${AppState.currentLogFilter}级别的日志...`;
    } else {
        logContent.textContent = AppState.filteredLogs.join('\n');
    }
}

// =====================================================================
// 环境变量凭证管理
// =====================================================================
async function checkEnvCredsStatus() {
    const loading = document.getElementById('envStatusLoading');
    const content = document.getElementById('envStatusContent');

    try {
        loading.style.display = 'block';
        content.classList.add('hidden');

        const response = await fetch('./auth/env-creds-status', { headers: getAuthHeaders() });
        const data = await response.json();

        if (response.ok) {
            const envVarsList = document.getElementById('envVarsList');
            envVarsList.textContent = Object.keys(data.available_env_vars).length > 0
                ? Object.keys(data.available_env_vars).join(', ')
                : '未找到GCLI_CREDS_*环境变量';

            const autoLoadStatus = document.getElementById('autoLoadStatus');
            autoLoadStatus.textContent = data.auto_load_enabled ? '✅ 已启用' : '❌ 未启用';
            autoLoadStatus.style.color = data.auto_load_enabled ? '#28a745' : '#dc3545';

            document.getElementById('envFilesCount').textContent = `${data.existing_env_files_count} 个文件`;

            const envFilesList = document.getElementById('envFilesList');
            envFilesList.textContent = data.existing_env_files.length > 0
                ? data.existing_env_files.join(', ')
                : '无';

            content.classList.remove('hidden');
            showStatus('环境变量状态检查完成', 'success');
        } else {
            showStatus(`获取环境变量状态失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        loading.style.display = 'none';
    }
}

async function loadEnvCredentials() {
    try {
        showStatus('正在从环境变量导入凭证...', 'info');

        const response = await fetch('./auth/load-env-creds', {
            method: 'POST',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            if (data.loaded_count > 0) {
                showStatus(`✅ 成功导入 ${data.loaded_count}/${data.total_count} 个凭证文件`, 'success');
                setTimeout(() => checkEnvCredsStatus(), 1000);
            } else {
                showStatus(`⚠️ ${data.message}`, 'info');
            }
        } else {
            showStatus(`导入失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

async function clearEnvCredentials() {
    if (!confirm('确定要清除所有从环境变量导入的凭证文件吗？\n这将删除所有文件名以 "env-" 开头的认证文件。')) {
        return;
    }

    try {
        showStatus('正在清除环境变量凭证文件...', 'info');

        const response = await fetch('./auth/env-creds', {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            showStatus(`✅ 成功删除 ${data.deleted_count} 个环境变量凭证文件`, 'success');
            setTimeout(() => checkEnvCredsStatus(), 1000);
        } else {
            showStatus(`清除失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

// =====================================================================
// 配置管理
// =====================================================================
async function loadConfig() {
    const loading = document.getElementById('configLoading');
    const form = document.getElementById('configForm');

    try {
        loading.style.display = 'block';
        form.classList.add('hidden');

        const response = await fetch('./config/get', { headers: getAuthHeaders() });
        const data = await response.json();

        if (response.ok) {
            AppState.currentConfig = data.config;
            AppState.envLockedFields = new Set(data.env_locked || []);

            populateConfigForm();
            form.classList.remove('hidden');
            showStatus('配置加载成功', 'success');
        } else {
            showStatus(`加载配置失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        loading.style.display = 'none';
    }
}

function populateConfigForm() {
    const c = AppState.currentConfig;

    setConfigField('host', c.host || '0.0.0.0');
    setConfigField('port', c.port || 7861);
    setConfigField('configApiPassword', c.api_password || '');
    setConfigField('configPanelPassword', c.panel_password || '');
    setConfigField('configPassword', c.password || 'pwd');
    setConfigField('credentialsDir', c.credentials_dir || '');
    setConfigField('proxy', c.proxy || '');
    setConfigField('codeAssistEndpoint', c.code_assist_endpoint || '');
    setConfigField('oauthProxyUrl', c.oauth_proxy_url || '');
    setConfigField('googleapisProxyUrl', c.googleapis_proxy_url || '');
    setConfigField('resourceManagerApiUrl', c.resource_manager_api_url || '');
    setConfigField('serviceUsageApiUrl', c.service_usage_api_url || '');
    setConfigField('antigravityApiUrl', c.antigravity_api_url || '');

    document.getElementById('autoBanEnabled').checked = Boolean(c.auto_ban_enabled);
    setConfigField('autoBanErrorCodes', (c.auto_ban_error_codes || []).join(','));
    setConfigField('callsPerRotation', c.calls_per_rotation || 10);

    document.getElementById('retry429Enabled').checked = Boolean(c.retry_429_enabled);
    setConfigField('retry429MaxRetries', c.retry_429_max_retries || 20);
    setConfigField('retry429Interval', c.retry_429_interval || 0.1);

    document.getElementById('compatibilityModeEnabled').checked = Boolean(c.compatibility_mode_enabled);
    document.getElementById('returnThoughtsToFrontend').checked = Boolean(c.return_thoughts_to_frontend !== false);

    setConfigField('antiTruncationMaxAttempts', c.anti_truncation_max_attempts || 3);
}

function setConfigField(fieldId, value) {
    const field = document.getElementById(fieldId);
    if (field) {
        field.value = value;
        const configKey = fieldId.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (AppState.envLockedFields.has(configKey)) {
            field.disabled = true;
            field.classList.add('env-locked');
        } else {
            field.disabled = false;
            field.classList.remove('env-locked');
        }
    }
}

async function saveConfig() {
    try {
        const getValue = (id, def = '') => document.getElementById(id)?.value.trim() || def;
        const getInt = (id, def = 0) => parseInt(document.getElementById(id)?.value) || def;
        const getFloat = (id, def = 0.0) => parseFloat(document.getElementById(id)?.value) || def;
        const getChecked = (id, def = false) => document.getElementById(id)?.checked || def;

        const config = {
            host: getValue('host', '0.0.0.0'),
            port: getInt('port', 7861),
            api_password: getValue('configApiPassword'),
            panel_password: getValue('configPanelPassword'),
            password: getValue('configPassword', 'pwd'),
            code_assist_endpoint: getValue('codeAssistEndpoint'),
            credentials_dir: getValue('credentialsDir'),
            proxy: getValue('proxy'),
            oauth_proxy_url: getValue('oauthProxyUrl'),
            googleapis_proxy_url: getValue('googleapisProxyUrl'),
            resource_manager_api_url: getValue('resourceManagerApiUrl'),
            service_usage_api_url: getValue('serviceUsageApiUrl'),
            antigravity_api_url: getValue('antigravityApiUrl'),
            auto_ban_enabled: getChecked('autoBanEnabled'),
            auto_ban_error_codes: getValue('autoBanErrorCodes').split(',')
                .map(c => parseInt(c.trim())).filter(c => !isNaN(c)),
            calls_per_rotation: getInt('callsPerRotation', 10),
            retry_429_enabled: getChecked('retry429Enabled'),
            retry_429_max_retries: getInt('retry429MaxRetries', 20),
            retry_429_interval: getFloat('retry429Interval', 0.1),
            compatibility_mode_enabled: getChecked('compatibilityModeEnabled'),
            return_thoughts_to_frontend: getChecked('returnThoughtsToFrontend'),
            anti_truncation_max_attempts: getInt('antiTruncationMaxAttempts', 3)
        };

        const response = await fetch('./config/save', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ config })
        });

        const data = await response.json();

        if (response.ok) {
            let message = '配置保存成功';

            if (data.hot_updated && data.hot_updated.length > 0) {
                message += `，以下配置已立即生效: ${data.hot_updated.join(', ')}`;
            }

            if (data.restart_required && data.restart_required.length > 0) {
                message += `\n⚠️ 重启提醒: ${data.restart_notice}`;
                showStatus(message, 'info');
            } else {
                showStatus(message, 'success');
            }

            setTimeout(() => loadConfig(), 1000);
        } else {
            showStatus(`保存配置失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

// 镜像网址配置
const mirrorUrls = {
    codeAssistEndpoint: 'https://gcli-api.sukaka.top/cloudcode-pa',
    oauthProxyUrl: 'https://gcli-api.sukaka.top/oauth2',
    googleapisProxyUrl: 'https://gcli-api.sukaka.top/googleapis',
    resourceManagerApiUrl: 'https://gcli-api.sukaka.top/cloudresourcemanager',
    serviceUsageApiUrl: 'https://gcli-api.sukaka.top/serviceusage',
    antigravityApiUrl: 'https://gcli-api.sukaka.top/daily-cloudcode-pa'
};

const officialUrls = {
    codeAssistEndpoint: 'https://cloudcode-pa.googleapis.com',
    oauthProxyUrl: 'https://oauth2.googleapis.com',
    googleapisProxyUrl: 'https://www.googleapis.com',
    resourceManagerApiUrl: 'https://cloudresourcemanager.googleapis.com',
    serviceUsageApiUrl: 'https://serviceusage.googleapis.com',
    antigravityApiUrl: 'https://daily-cloudcode-pa.sandbox.googleapis.com'
};

function useMirrorUrls() {
    if (confirm('确定要将所有端点配置为镜像网址吗？')) {
        for (const [fieldId, url] of Object.entries(mirrorUrls)) {
            const field = document.getElementById(fieldId);
            if (field && !field.disabled) field.value = url;
        }
        showStatus('✅ 已切换到镜像网址配置，记得点击"保存配置"按钮保存设置', 'success');
    }
}

function restoreOfficialUrls() {
    if (confirm('确定要将所有端点配置为官方地址吗？')) {
        for (const [fieldId, url] of Object.entries(officialUrls)) {
            const field = document.getElementById(fieldId);
            if (field && !field.disabled) field.value = url;
        }
        showStatus('✅ 已切换到官方端点配置，记得点击"保存配置"按钮保存设置', 'success');
    }
}

// =====================================================================
// 使用统计
// =====================================================================
async function refreshUsageStats() {
    const loading = document.getElementById('usageLoading');
    const list = document.getElementById('usageList');

    try {
        loading.style.display = 'block';
        list.innerHTML = '';

        const [statsResponse, aggregatedResponse] = await Promise.all([
            fetch('./usage/stats', { headers: getAuthHeaders() }),
            fetch('./usage/aggregated', { headers: getAuthHeaders() })
        ]);

        if (statsResponse.status === 401 || aggregatedResponse.status === 401) {
            showStatus('认证失败，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }

        const statsData = await statsResponse.json();
        const aggregatedData = await aggregatedResponse.json();

        if (statsResponse.ok && aggregatedResponse.ok) {
            AppState.usageStatsData = statsData.success ? statsData.data : statsData;

            const aggData = aggregatedData.success ? aggregatedData.data : aggregatedData;
            document.getElementById('totalApiCalls').textContent = aggData.total_calls_24h || 0;
            document.getElementById('totalFiles').textContent = aggData.total_files || 0;
            document.getElementById('avgCallsPerFile').textContent = (aggData.avg_calls_per_file || 0).toFixed(1);

            renderUsageList();

            showStatus(`已加载 ${aggData.total_files || Object.keys(AppState.usageStatsData).length} 个文件的使用统计`, 'success');
        } else {
            const errorMsg = statsData.detail || aggregatedData.detail || '加载使用统计失败';
            showStatus(`错误: ${errorMsg}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        loading.style.display = 'none';
    }
}

function renderUsageList() {
    const list = document.getElementById('usageList');
    list.innerHTML = '';

    if (Object.keys(AppState.usageStatsData).length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #666;">暂无使用统计数据</p>';
        return;
    }

    for (const [filename, stats] of Object.entries(AppState.usageStatsData)) {
        const card = document.createElement('div');
        card.className = 'usage-card';

        const calls24h = stats.calls_24h || 0;

        card.innerHTML = `
            <div class="usage-header">
                <div class="usage-filename">${filename}</div>
            </div>
            <div class="usage-info">
                <div class="usage-info-item" style="grid-column: 1 / -1;">
                    <span class="usage-info-label">24小时内调用次数</span>
                    <span class="usage-info-value" style="font-size: 24px; font-weight: bold; color: #007bff;">${calls24h}</span>
                </div>
            </div>
            <div class="usage-actions">
                <button class="usage-btn reset" onclick="resetSingleUsageStats('${filename}')">重置统计</button>
            </div>
        `;

        list.appendChild(card);
    }
}

async function resetSingleUsageStats(filename) {
    if (!confirm(`确定要重置 ${filename} 的使用统计吗？`)) return;

    try {
        const response = await fetch('./usage/reset', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ filename })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showStatus(data.message, 'success');
            await refreshUsageStats();
        } else {
            showStatus(`重置失败: ${data.message || data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

async function resetAllUsageStats() {
    if (!confirm('确定要重置所有文件的使用统计吗？此操作不可恢复！')) return;

    try {
        const response = await fetch('./usage/reset', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({})
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showStatus(data.message, 'success');
            await refreshUsageStats();
        } else {
            showStatus(`重置失败: ${data.message || data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

// =====================================================================
// 冷却倒计时自动更新
// =====================================================================
function startCooldownTimer() {
    if (AppState.cooldownTimerInterval) {
        clearInterval(AppState.cooldownTimerInterval);
    }

    AppState.cooldownTimerInterval = setInterval(() => {
        updateCooldownDisplays();
    }, 1000);
}

function stopCooldownTimer() {
    if (AppState.cooldownTimerInterval) {
        clearInterval(AppState.cooldownTimerInterval);
        AppState.cooldownTimerInterval = null;
    }
}

function updateCooldownDisplays() {
    let needsRefresh = false;

    // 检查模型级冷却是否过期
    for (const credInfo of Object.values(AppState.creds.data)) {
        if (credInfo.model_cooldowns && Object.keys(credInfo.model_cooldowns).length > 0) {
            const currentTime = Date.now() / 1000;
            const hasExpiredCooldowns = Object.entries(credInfo.model_cooldowns).some(([, until]) => until <= currentTime);

            if (hasExpiredCooldowns) {
                needsRefresh = true;
                break;
            }
        }
    }

    if (needsRefresh) {
        AppState.creds.renderList();
        return;
    }

    // 更新模型级冷却的显示
    document.querySelectorAll('.cooldown-badge').forEach(badge => {
        const card = badge.closest('.cred-card');
        const filenameEl = card?.querySelector('.cred-filename');
        if (!filenameEl) return;

        const filename = filenameEl.textContent;
        const credInfo = Object.values(AppState.creds.data).find(c => c.filename === filename);

        if (credInfo && credInfo.model_cooldowns) {
            const currentTime = Date.now() / 1000;
            const titleMatch = badge.getAttribute('title')?.match(/模型: (.+)/);
            if (titleMatch) {
                const model = titleMatch[1];
                const cooldownUntil = credInfo.model_cooldowns[model];
                if (cooldownUntil) {
                    const remaining = Math.max(0, Math.floor(cooldownUntil - currentTime));
                    if (remaining > 0) {
                        const shortModel = model.replace('gemini-', '').replace('-exp', '')
                            .replace('2.0-', '2-').replace('1.5-', '1.5-');
                        const timeDisplay = formatCooldownTime(remaining).replace(/s$/, '').replace(/ /g, '');
                        badge.innerHTML = `🔧 ${shortModel}: ${timeDisplay}`;
                    }
                }
            }
        }
    });
}

// =====================================================================
// 页面初始化
// =====================================================================
window.onload = async function() {
    const autoLoginSuccess = await autoLogin();

    if (!autoLoginSuccess) {
        showStatus('请输入密码登录', 'info');
    }

    startCooldownTimer();

    const antigravityAuthBtn = document.getElementById('getAntigravityAuthBtn');
    if (antigravityAuthBtn) {
        antigravityAuthBtn.addEventListener('click', startAntigravityAuth);
    }
};

// 拖拽功能 - 初始化
document.addEventListener('DOMContentLoaded', function() {
    const uploadArea = document.getElementById('uploadArea');

    if (uploadArea) {
        uploadArea.addEventListener('dragover', (event) => {
            event.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', (event) => {
            event.preventDefault();
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (event) => {
            event.preventDefault();
            uploadArea.classList.remove('dragover');
            AppState.uploadFiles.addFiles(Array.from(event.dataTransfer.files));
        });
    }
});

// ==================== Antigravity 使用量相关函数 ====================

// 全局变量：是否显示所有账号
let showAllAccounts = false;

/**
 * 切换显示所有账号
 */
function toggleShowAllAccounts() {
    const checkbox = document.getElementById('showAllAccountsCheckbox');
    showAllAccounts = checkbox ? checkbox.checked : false;
    refreshAntigravityUsage();
}

/**
 * 刷新 Antigravity 使用量信息
 */
async function refreshAntigravityUsage() {
    const usageContent = document.getElementById('antigravityUsageContent');
    if (!usageContent) return;

    // 显示加载状态
    usageContent.className = 'loading';
    usageContent.textContent = '正在加载使用量信息...';

    try {
        // 根据是否显示所有账号选择不同的 API
        const apiUrl = showAllAccounts ? '/antigravity/usage/all' : '/antigravity/usage';

        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${AppState.authToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (showAllAccounts) {
            displayAllAntigravityUsage(data);
        } else {
            displayAntigravityUsage(data);
        }
    } catch (error) {
        console.error('获取 Antigravity 使用量失败:', error);
        usageContent.className = 'error';
        usageContent.innerHTML = `<p style="color: #dc3545;">获取使用量失败: ${error.message}</p>`;
    }
}

/**
 * 展示 Antigravity 使用量信息
 */
function displayAntigravityUsage(data) {
    const usageContent = document.getElementById('antigravityUsageContent');
    if (!usageContent) return;

    usageContent.className = '';

    // 解析数据（参考 AIClient-2-API 的格式）
    const models = data.models || {};
    const lastUpdated = data.lastUpdated ? new Date(data.lastUpdated * 1000).toLocaleString('zh-CN') : 'N/A';

    // 构建 HTML
    let html = '<div class="user-info-section">';
    html += '<div style="font-weight: bold; margin-bottom: 10px;">Antigravity 使用量信息</div>';
    html += '<div class="user-info-grid">';
    html += `<div class="user-info-item"><span class="user-info-label">最后更新:</span>${lastUpdated}</div>`;
    html += `<div class="user-info-item"><span class="user-info-label">模型数量:</span>${Object.keys(models).length}</div>`;
    html += '</div>';
    html += '</div>';

    // 构建模型配额信息
    const modelEntries = Object.entries(models);

    if (modelEntries.length > 0) {
        html += '<div class="usage-grid">';

        modelEntries.forEach(([modelName, modelInfo]) => {
            const remainingFraction = modelInfo.remaining || 0;
            const remainingPercentage = (remainingFraction * 100).toFixed(1);

            // 确定颜色等级
            let barClass = 'high';
            if (remainingPercentage < 10) {
                barClass = 'low';
            } else if (remainingPercentage < 30) {
                barClass = 'medium';
            }

            // 格式化重置时间
            let resetTimeText = 'N/A';
            if (modelInfo.resetTime || modelInfo.resetTimeRaw) {
                const resetDate = new Date(modelInfo.resetTime || modelInfo.resetTimeRaw);
                const now = new Date();
                const delta = resetDate - now;

                if (delta > 0) {
                    const hours = Math.floor(delta / (1000 * 60 * 60));
                    const minutes = Math.floor((delta % (1000 * 60 * 60)) / (1000 * 60));
                    resetTimeText = `${hours}小时${minutes}分钟后重置`;
                } else {
                    resetTimeText = '已重置';
                }
            }

            html += '<div class="usage-card">';
            html += `<div class="usage-card-header">${modelInfo.displayName || modelName}</div>`;
            html += `<div class="usage-percentage">${remainingPercentage}%</div>`;
            html += '<div class="usage-bar-container">';
            html += `<div class="usage-bar ${barClass}" style="width: ${remainingPercentage}%"></div>`;
            html += '</div>';
            html += `<div class="usage-text">剩余配额: ${remainingPercentage}%</div>`;
            html += `<div class="usage-reset-time">${resetTimeText}</div>`;
            html += '</div>';
        });

        html += '</div>';
    } else {
        html += '<p style="color: #666; text-align: center; margin-top: 20px;">暂无模型配额信息</p>';
    }

    usageContent.innerHTML = html;
}

/**
 * 展示所有 Antigravity 账号的使用量信息
 */
function displayAllAntigravityUsage(data) {
    const usageContent = document.getElementById('antigravityUsageContent');
    if (!usageContent) return;

    usageContent.className = '';

    const credentials = data.credentials || [];
    const total = data.total || 0;

    // 构建 HTML
    let html = '<div class="user-info-section">';
    html += '<div style="font-weight: bold; margin-bottom: 10px;">所有 Antigravity 账号使用量</div>';
    html += '<div class="user-info-grid">';
    html += `<div class="user-info-item"><span class="user-info-label">账号总数:</span>${total}</div>`;
    html += '</div>';
    html += '</div>';

    if (credentials.length > 0) {
        // 遍历每个账号
        credentials.forEach((credential, index) => {
            const credentialName = credential.credentialName || `账号 ${index + 1}`;
            const models = credential.models || {};
            const hasError = credential.error;

            html += `<div class="usage-container" style="margin-top: 15px; border-left: 3px solid ${hasError ? '#dc3545' : '#4285f4'};">`;
            html += `<div style="font-weight: bold; margin-bottom: 10px; padding: 5px 10px; background-color: #f8f9fa;">`;
            html += `${credentialName}`;
            if (hasError) {
                html += ` <span style="color: #dc3545; font-size: 12px;">(错误: ${credential.error})</span>`;
            }
            html += `</div>`;

            if (!hasError && Object.keys(models).length > 0) {
                html += '<div class="usage-grid">';

                Object.entries(models).forEach(([modelName, modelInfo]) => {
                    const remainingFraction = modelInfo.remaining || 0;
                    const remainingPercentage = (remainingFraction * 100).toFixed(1);

                    // 确定颜色等级
                    let barClass = 'high';
                    if (remainingPercentage < 10) {
                        barClass = 'low';
                    } else if (remainingPercentage < 30) {
                        barClass = 'medium';
                    }

                    // 格式化重置时间
                    let resetTimeText = 'N/A';
                    if (modelInfo.resetTime || modelInfo.resetTimeRaw) {
                        const resetDate = new Date(modelInfo.resetTime || modelInfo.resetTimeRaw);
                        const now = new Date();
                        const delta = resetDate - now;

                        if (delta > 0) {
                            const hours = Math.floor(delta / (1000 * 60 * 60));
                            const minutes = Math.floor((delta % (1000 * 60 * 60)) / (1000 * 60));
                            resetTimeText = `${hours}小时${minutes}分钟后重置`;
                        } else {
                            resetTimeText = '已重置';
                        }
                    }

                    html += '<div class="usage-card">';
                    html += `<div class="usage-card-header">${modelInfo.displayName || modelName}</div>`;
                    html += `<div class="usage-percentage">${remainingPercentage}%</div>`;
                    html += '<div class="usage-bar-container">';
                    html += `<div class="usage-bar ${barClass}" style="width: ${remainingPercentage}%"></div>`;
                    html += '</div>';
                    html += `<div class="usage-text">剩余配额: ${remainingPercentage}%</div>`;
                    html += `<div class="usage-reset-time">${resetTimeText}</div>`;
                    html += '</div>';
                });

                html += '</div>';
            } else if (!hasError) {
                html += '<p style="color: #666; text-align: center; padding: 10px;">暂无模型配额信息</p>';
            }

            html += '</div>';
        });
    } else {
        html += '<p style="color: #666; text-align: center; margin-top: 20px;">暂无账号信息</p>';
    }

    usageContent.innerHTML = html;
}

/**
 * 初始化 Antigravity 使用量（在切换到 Antigravity 管理标签时调用）
 */
function initAntigravityUsage() {
    const usageContent = document.getElementById('antigravityUsageContent');
    if (usageContent && usageContent.className === 'loading') {
        refreshAntigravityUsage();
    }
}

// 在切换标签时自动加载使用量
const originalSwitchTab = window.switchTab;
window.switchTab = function(tabName) {
    if (originalSwitchTab) {
        originalSwitchTab(tabName);
    }

    // 如果切换到 Antigravity 管理标签，自动加载使用量
    if (tabName === 'antigravity-manage') {
        setTimeout(() => {
            initAntigravityUsage();
        }, 100);
    }
};

