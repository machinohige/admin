// グローバル変数
const API_BASE_URL = 'https://kunugida-reservation-admin-api-pv3b3g64na-an.a.run.app';

// デバッグ: 起動時にURLを確認
console.log('=== 予約管理システム起動 ===');
console.log('API_BASE_URL:', API_BASE_URL);
console.log('API_BASE_URLが "YOUR_CLOUD_RUN_URL" のままの場合は、実際のCloud RunのURLに置き換えてください');
console.log('========================');

let authToken = localStorage.getItem('authToken');
let currentDate = '11/1';
let lastUpdate = null;
let reservationsCache = [];
let selectedReservations = [];
let absentCheckInterval = null;
let autoStopCheckInterval = null; // 自動停止チェック用
let currentSettings = null; // 設定をキャッシュ

// ユーティリティ関数
function formatDateTime(isoString) {
    if (!isoString) return '--';
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function formatTime(isoString) {
    if (!isoString) return '--';
    const date = new Date(isoString);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function getElapsedTime(isoString) {
    if (!isoString) return '--';
    const now = new Date();
    const created = new Date(isoString);
    const diffMs = now - created;
    const diffMins = Math.floor(diffMs / 1000 / 60);
    const diffSecs = Math.floor((diffMs / 1000) % 60);
    
    if (diffMins > 0) {
        return `${diffMins}分${diffSecs}秒`;
    } else {
        return `${diffSecs}秒`;
    }
}

function updateCurrentTime() {
    document.getElementById('current-time').textContent = formatDateTime(new Date().toISOString());
}

function updateLastUpdateTime() {
    lastUpdate = new Date().toISOString();
    document.getElementById('last-update').textContent = formatDateTime(lastUpdate);
}

// API呼び出し
async function apiCall(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
        }
    };

    if (authToken) {
        options.headers['Authorization'] = authToken;
    }

    if (data) {
        options.body = JSON.stringify(data);
    }

    try {
        const url = `${API_BASE_URL}${endpoint}`;
        console.log('API Call:', method, url);
        
        const response = await fetch(url, options);
        
        console.log('API Response Status:', response.status);
        
        if (response.status === 401) {
            logout();
            return null;
        }

        // レスポンスのContent-Typeを確認
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('Non-JSON response:', text.substring(0, 200));
            alert(`APIエラー: JSONではないレスポンスが返されました。\nURL: ${url}\nStatus: ${response.status}\n\nコンソールを確認してください。`);
            return null;
        }

        const result = await response.json();
        return result;
    } catch (error) {
        console.error('API Error:', error);
        console.error('URL:', `${API_BASE_URL}${endpoint}`);
        alert(`通信エラーが発生しました\nエンドポイント: ${endpoint}\nエラー: ${error.message}\n\nAPI_BASE_URL: ${API_BASE_URL}`);
        return null;
    }
}

// 認証関連
async function login() {
    const password = document.getElementById('password-input').value;
    const errorElement = document.getElementById('login-error');

    if (!password) {
        errorElement.textContent = 'パスワードを入力してください';
        return;
    }

    const result = await apiCall('/api/login', 'POST', { password });

    if (result && result.success) {
        authToken = result.token;
        localStorage.setItem('authToken', authToken);
        showMainScreen();
    } else {
        errorElement.textContent = 'パスワードが正しくありません';
    }
}

function logout() {
    apiCall('/api/logout', 'POST');
    authToken = null;
    localStorage.removeItem('authToken');
    showLoginScreen();
}

function showLoginScreen() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('main-screen').classList.add('hidden');
    document.getElementById('password-input').value = '';
    document.getElementById('login-error').textContent = '';
}

function showMainScreen() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
    initMainScreen();
}

// メイン画面初期化
async function initMainScreen() {
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
    
    // 設定を読み込む
    await loadSettingsToCache();
    
    loadCurrentTab();
}

// タブ切り替え
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');

    loadCurrentTab();
}

function loadCurrentTab() {
    const activeTab = document.querySelector('.tab-btn.active').dataset.tab;

    switch (activeTab) {
        case 'group':
            loadGroupScreen();
            startAbsentCheck();
            break;
        case 'list':
            loadReservationList();
            stopAbsentCheck();
            break;
        case 'stats':
            loadStats();
            stopAbsentCheck();
            break;
        case 'settings':
            loadSettingsUI(); // UIだけ更新
            stopAbsentCheck();
            break;
        default:
            stopAbsentCheck();
    }

    updateLastUpdateTime();
}

// グループ呼び出し画面
async function loadGroupScreen() {
    const data = await apiCall(`/api/reservations?date=${currentDate}&status=0`);
    
    if (!data) return;

    reservationsCache = data;

    const normalQueue = document.getElementById('normal-queue');
    const priorityQueue = document.getElementById('priority-queue');

    normalQueue.innerHTML = '';
    priorityQueue.innerHTML = '';

    // 通常予約とプライオリティ予約を分類
    const normalReservations = [];
    const priorityReservations = [];

    data.forEach(res => {
        // 不在の予約は除外
        if (res.absent) {
            return;
        }
        
        const firstChar = res.id[0];
        
        if (firstChar === 'X' || firstChar === 'Y') {
            // プライオリティ予約
            if ((currentDate === '11/1' && firstChar === 'X') ||
                (currentDate === '11/2' && firstChar === 'Y')) {
                priorityReservations.push(res);
            }
        } else {
            // 通常予約
            if ((currentDate === '11/1' && (firstChar === 'A' || firstChar === 'C')) ||
                (currentDate === '11/2' && (firstChar === 'B' || firstChar === 'D'))) {
                normalReservations.push(res);
            }
        }
    });

    // 通常予約をソート（priority:true → false、created_at昇順）
    normalReservations.sort((a, b) => {
        if (a.priority !== b.priority) {
            return b.priority ? 1 : -1;
        }
        return new Date(a.created_at) - new Date(b.created_at);
    });

    // プライオリティ予約をソート（time昇順）
    priorityReservations.sort((a, b) => {
        if (!a.time || !b.time) return 0;
        return a.time.localeCompare(b.time);
    });

    // 描画
    normalReservations.forEach(res => {
        normalQueue.appendChild(createReservationCard(res));
    });

    priorityReservations.forEach(res => {
        priorityQueue.appendChild(createReservationCard(res, true));
    });
}

function createReservationCard(reservation, showTime = false) {
    const card = document.createElement('div');
    card.className = 'reservation-card';
    card.draggable = true;
    card.dataset.id = reservation.id;
    card.dataset.count = reservation.count;
    card.dataset.createdAt = reservation.created_at || '';

    // 作成時刻と経過時間を計算
    const createdTime = formatTime(reservation.created_at);
    const elapsed = getElapsedTime(reservation.created_at);

    card.innerHTML = `
        <div class="reservation-info">
            <span class="reservation-id">${reservation.id}</span>
            <span class="reservation-count">${reservation.count}人</span>
        </div>
        ${showTime && reservation.time ? `<div class="reservation-time">予約時間: ${reservation.time}</div>` : ''}
        ${!showTime ? `
        <div class="reservation-created">
            <small>登録: ${createdTime} (${elapsed})</small>
        </div>
        ` : ''}
        <div class="reservation-actions">
            <button class="btn-small btn-cancel" onclick="cancelReservation('${reservation.id}')">キャンセル</button>
        </div>
    `;

    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);

    return card;
}

// ドラッグ&ドロップ処理
function handleDragStart(e) {
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.innerHTML);
    e.dataTransfer.setData('reservationId', e.target.dataset.id);
    e.dataTransfer.setData('reservationCount', e.target.dataset.count);
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
}

function setupDropZone() {
    const dropZone = document.getElementById('call-group');

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');

        const reservationId = e.dataTransfer.getData('reservationId');
        const reservationCount = parseInt(e.dataTransfer.getData('reservationCount'));

        addToCallGroup(reservationId, reservationCount);
    });
}

function addToCallGroup(reservationId, reservationCount) {
    // 既に追加されているかチェック
    if (selectedReservations.find(r => r.id === reservationId)) {
        return;
    }

    // 人数チェック
    const currentCount = selectedReservations.reduce((sum, r) => sum + r.count, 0);
    if (currentCount + reservationCount > 4) {
        alert('グループの人数は4人までです');
        return;
    }

    selectedReservations.push({ id: reservationId, count: reservationCount });
    renderCallGroup();
    updateGroupCount();

    // 元のキューから削除
    const originalCard = document.querySelector(`[data-id="${reservationId}"]`);
    if (originalCard && originalCard.parentElement.id !== 'call-group') {
        originalCard.remove();
    }
}

function renderCallGroup() {
    const callGroup = document.getElementById('call-group');
    const placeholder = callGroup.querySelector('.placeholder');
    if (placeholder) placeholder.remove();

    callGroup.innerHTML = '';

    selectedReservations.forEach(res => {
        const reservation = reservationsCache.find(r => r.id === res.id);
        if (!reservation) return;

        const card = document.createElement('div');
        card.className = 'reservation-card selected';
        card.dataset.id = res.id;

        card.innerHTML = `
            <div class="reservation-info">
                <span class="reservation-id">${res.id}</span>
                <span class="reservation-count">${res.count}人</span>
            </div>
            <div class="reservation-actions">
                <button class="btn-small btn-absent" onclick="markAsAbsent('${res.id}')">不在</button>
                <button class="btn-small btn-cancel" onclick="removeFromCallGroup('${res.id}')">削除</button>
            </div>
        `;

        callGroup.appendChild(card);
    });

    if (selectedReservations.length === 0) {
        callGroup.innerHTML = '<p class="placeholder">予約をドラッグ&ドロップ</p>';
    }
}

function removeFromCallGroup(reservationId) {
    selectedReservations = selectedReservations.filter(r => r.id !== reservationId);
    renderCallGroup();
    updateGroupCount();
    loadGroupScreen();
}

function updateGroupCount() {
    const count = selectedReservations.reduce((sum, r) => sum + r.count, 0);
    document.getElementById('group-count').textContent = `${count}/4人`;
    document.getElementById('accept-btn').disabled = selectedReservations.length === 0;
}

async function acceptGroup() {
    if (selectedReservations.length === 0) return;

    const ids = selectedReservations.map(r => r.id);
    
    // 各予約のstatusを1に更新
    for (const id of ids) {
        await apiCall(`/api/reservations/${id}`, 'PUT', { status: 1 });
    }

    selectedReservations = [];
    renderCallGroup();
    updateGroupCount();
    loadGroupScreen();
}

async function markAsAbsent(reservationId) {
    const result = await apiCall(`/api/reservations/${reservationId}`, 'PUT', {
        absent: true
    });

    if (result && result.success) {
        // 呼び出しグループから削除
        removeFromCallGroup(reservationId);
        
        // 待機中のリストから削除（DOMから直接削除）
        const cardInQueue = document.querySelector(`#normal-queue [data-id="${reservationId}"], #priority-queue [data-id="${reservationId}"]`);
        if (cardInQueue) {
            cardInQueue.remove();
        }
        
        // 不在リストを再読み込み
        loadAbsentList();
    }
}

async function loadAbsentList() {
    const data = await apiCall(`/api/reservations?date=${currentDate}`);
    
    if (!data) return;

    const absentList = document.getElementById('absent-list');
    absentList.innerHTML = '';

    const absentReservations = data.filter(r => r.absent);

    absentReservations.forEach(res => {
        const card = document.createElement('div');
        card.className = 'absent-card';
        card.draggable = true;
        card.dataset.id = res.id;
        card.dataset.count = res.count;

        const elapsedMinutes = Math.floor((new Date() - new Date(res.absent_at)) / 1000 / 60);
        const elapsedClass = elapsedMinutes >= 15 ? 'warning' : '';

        card.innerHTML = `
            <div class="reservation-info">
                <span class="reservation-id">${res.id}</span>
                <span class="reservation-count">${res.count}人</span>
            </div>
            <div class="absent-elapsed ${elapsedClass}">
                不在時刻: ${formatDateTime(res.absent_at)}<br>
                経過時間: ${elapsedMinutes}分
            </div>
            <div class="reservation-actions">
                <button class="btn-small btn-guide" onclick="guideAbsent('${res.id}')">案内</button>
            </div>
        `;

        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);

        absentList.appendChild(card);

        // 15分経過で自動削除
        if (elapsedMinutes >= 15) {
            setTimeout(() => deleteReservation(res.id), 0);
        }
    });
}

async function guideAbsent(reservationId) {
    const result = await apiCall(`/api/reservations/${reservationId}`, 'DELETE');

    if (result && result.success) {
        loadAbsentList();
        loadGroupScreen();
    }
}

function startAbsentCheck() {
    if (absentCheckInterval) return;
    
    absentCheckInterval = setInterval(() => {
        loadAbsentList();
        updateElapsedTimes(); // 経過時間を更新
    }, 30000); // 30秒ごとにチェック

    loadAbsentList();
    
    // 自動停止チェックも開始（1分ごと）
    if (!autoStopCheckInterval) {
        checkAutoStop(); // 初回実行
        autoStopCheckInterval = setInterval(() => {
            checkAutoStop();
        }, 60000); // 1分ごと
    }
}

function stopAbsentCheck() {
    if (absentCheckInterval) {
        clearInterval(absentCheckInterval);
        absentCheckInterval = null;
    }
    
    // 自動停止チェックも停止
    if (autoStopCheckInterval) {
        clearInterval(autoStopCheckInterval);
        autoStopCheckInterval = null;
    }
}

// 画面上の経過時間表示を更新
function updateElapsedTimes() {
    document.querySelectorAll('.reservation-card').forEach(card => {
        const createdAt = card.dataset.createdAt;
        if (!createdAt) return;
        
        const elapsed = getElapsedTime(createdAt);
        const createdTimeElement = card.querySelector('.reservation-created small');
        if (createdTimeElement) {
            const createdTime = formatTime(createdAt);
            createdTimeElement.textContent = `登録: ${createdTime} (${elapsed})`;
        }
    });
}

async function cancelReservation(reservationId) {
    if (!confirm('この予約をキャンセルしますか？')) return;

    const result = await apiCall(`/api/reservations/${reservationId}`, 'DELETE');

    if (result && result.success) {
        loadGroupScreen();
    }
}

async function deleteReservation(reservationId) {
    await apiCall(`/api/reservations/${reservationId}`, 'DELETE');
}

// 予約一覧画面
async function loadReservationList() {
    const statusFilter = document.getElementById('filter-status').value;
    const countFilter = document.getElementById('filter-count').value;

    let query = `date=${currentDate}`;
    if (statusFilter) query += `&status=${statusFilter}`;
    if (countFilter) query += `&count=${countFilter}`;

    const data = await apiCall(`/api/reservations?${query}`);
    
    if (!data) return;

    const listContainer = document.getElementById('reservation-list');
    listContainer.innerHTML = '';

    if (data.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: #999; padding: 2rem;">予約がありません</p>';
        return;
    }

    data.forEach(res => {
        const item = document.createElement('div');
        item.className = 'reservation-list-item';

        const statusText = res.status === 0 ? '待機中' : '来店済み';
        const statusClass = res.status === 0 ? 'status-waiting' : 'status-completed';

        item.innerHTML = `
            <div class="reservation-list-info">
                <div class="reservation-list-id">${res.id}</div>
                <div class="reservation-list-details">
                    ${res.count}人
                    <span class="status-badge ${statusClass}">${statusText}</span>
                    ${res.time ? `<span style="margin-left: 0.5rem;">予約時間: ${res.time}</span>` : ''}
                </div>
            </div>
            <div class="reservation-actions">
                ${res.status === 0 ? `<button class="btn-small btn-primary" onclick="updateReservationStatus('${res.id}', 1)">来店済み</button>` : ''}
                <button class="btn-small btn-cancel" onclick="cancelReservation('${res.id}'); loadReservationList();">キャンセル</button>
            </div>
        `;

        listContainer.appendChild(item);
    });
}

async function updateReservationStatus(reservationId, status) {
    const result = await apiCall(`/api/reservations/${reservationId}`, 'PUT', { status });

    if (result && result.success) {
        loadReservationList();
    }
}

// 予約追加画面
function setupAddReservation() {
    const typeSelect = document.getElementById('add-type');
    const timeGroup = document.getElementById('time-group');
    const dateSelect = document.getElementById('add-date');

    typeSelect.addEventListener('change', (e) => {
        const type = e.target.value;
        if (type === 'X' || type === 'Y') {
            timeGroup.style.display = 'block';
        } else {
            timeGroup.style.display = 'none';
        }
    });

    dateSelect.addEventListener('change', (e) => {
        updateTypeOptions(e.target.value);
    });
}

function updateTypeOptions(date) {
    const typeSelect = document.getElementById('add-type');
    
    if (date === '11/1') {
        typeSelect.innerHTML = `
            <option value="C">C（通常・11/1）</option>
            <option value="X">X（関係者・11/1）</option>
        `;
    } else {
        typeSelect.innerHTML = `
            <option value="D">D（通常・11/2）</option>
            <option value="Y">Y（関係者・11/2）</option>
        `;
    }

    typeSelect.dispatchEvent(new Event('change'));
}

async function submitReservation() {
    const date = document.getElementById('add-date').value;
    const type = document.getElementById('add-type').value;
    const count = parseInt(document.getElementById('add-count').value);
    const time = document.getElementById('add-time').value;
    const messageElement = document.getElementById('add-message');

    const data = { date, type, count };

    if (type === 'X' || type === 'Y') {
        if (!time) {
            messageElement.textContent = '予約時間を入力してください';
            messageElement.className = 'message error';
            return;
        }
        data.time = time;
    }

    const result = await apiCall('/api/reservations', 'POST', data);

    if (result && result.success) {
        messageElement.textContent = `予約を追加しました: ${result.id}`;
        messageElement.className = 'message success';
        
        // フォームをリセット
        document.getElementById('add-count').value = '1';
        document.getElementById('add-time').value = '';
    } else {
        messageElement.textContent = '予約の追加に失敗しました';
        messageElement.className = 'message error';
    }
}

// 統計画面
async function loadStats() {
    const data = await apiCall(`/api/stats?date=${currentDate}`);
    
    if (!data) return;

    document.getElementById('stat-total').textContent = data.total_reservations;
    document.getElementById('stat-completed').textContent = `${data.completed_groups}組`;
    document.getElementById('stat-waiting').textContent = `${data.waiting_groups}組`;
    document.getElementById('stat-people').textContent = `${data.total_people}人`;

    renderChart(data);
}

function renderChart(data) {
    const canvas = document.getElementById('hourly-chart');
    const ctx = canvas.getContext('2d');

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hours = Object.keys(data.hourly_reservations).sort();
    const reservations = hours.map(h => data.hourly_reservations[h]);
    const completed = hours.map(h => data.hourly_completed[h]);

    const maxValue = Math.max(...reservations, 10);
    const chartHeight = 250;
    const chartWidth = canvas.width - 80;
    const barWidth = chartWidth / hours.length / 2 - 10;
    const startX = 50;
    const startY = 30;

    // 背景グリッド
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = startY + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(startX + chartWidth, y);
        ctx.stroke();
    }

    // バーを描画
    hours.forEach((hour, index) => {
        const x = startX + (chartWidth / hours.length) * index + 10;
        const reservationHeight = (reservations[index] / maxValue) * chartHeight;
        const completedHeight = (completed[index] / maxValue) * chartHeight;

        // 予約数バー（グレー）
        ctx.fillStyle = '#ddd';
        ctx.fillRect(x, startY + chartHeight - reservationHeight, barWidth, reservationHeight);

        // 来店数バー（黒）
        ctx.fillStyle = '#333';
        ctx.fillRect(x + barWidth + 5, startY + chartHeight - completedHeight, barWidth, completedHeight);

        // 時間ラベル
        ctx.fillStyle = '#666';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${hour}時`, x + barWidth, startY + chartHeight + 20);
    });

    // 凡例
    ctx.fillStyle = '#ddd';
    ctx.fillRect(startX + chartWidth - 150, 10, 20, 15);
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('予約数', startX + chartWidth - 125, 22);

    ctx.fillStyle = '#333';
    ctx.fillRect(startX + chartWidth - 60, 10, 20, 15);
    ctx.fillStyle = '#333';
    ctx.fillText('来店数', startX + chartWidth - 35, 22);
}

// 設定画面
async function loadSettingsToCache() {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] === 設定を読み込み開始 ===`);
    console.trace('呼び出し元のスタックトレース'); // どこから呼ばれたか確認
    
    const data = await apiCall('/api/settings');
    
    console.log(`[${timestamp}] API応答:`, JSON.stringify(data));
    
    if (data && typeof data === 'object' && !data.error) {
        // Firebaseから取得した値をそのまま使用（デフォルト値なし）
        currentSettings = data;
        console.log(`[${timestamp}] ✅ 設定を読み込みました:`, JSON.stringify(currentSettings));
    } else {
        console.error(`[${timestamp}] ❌ 設定の読み込みに失敗しました`);
        currentSettings = null;
    }
    console.log(`[${timestamp}] === 設定読み込み完了 ===\n`);
}

// 設定画面のUIだけ更新（キャッシュから）
function loadSettingsUI() {
    // キャッシュがない場合は読み込む
    if (!currentSettings) {
        loadSettingsToCache().then(() => {
            updateSettingsUI();
        });
    } else {
        updateSettingsUI();
    }
}

function updateSettingsUI() {
    if (!currentSettings) {
        console.error('設定データがありません');
        return;
    }
    
    // Firebaseの値をそのまま反映（デフォルト値なし）
    document.getElementById('setting-reception').checked = currentSettings.reception === true;
    document.getElementById('setting-joukyou').checked = currentSettings.joukyou === true;
    document.getElementById('setting-jidou').checked = currentSettings.jidou === true;
    
    console.log('設定画面を表示:', JSON.stringify(currentSettings));
    console.log('  reception:', currentSettings.reception, '型:', typeof currentSettings.reception);
    console.log('  joukyou:', currentSettings.joukyou, '型:', typeof currentSettings.joukyou);
    console.log('  jidou:', currentSettings.jidou, '型:', typeof currentSettings.jidou);
}

async function saveSettings() {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] === 設定を保存 ===`);
    
    const settings = {
        reception: document.getElementById('setting-reception').checked,
        joukyou: document.getElementById('setting-joukyou').checked,
        jidou: document.getElementById('setting-jidou').checked
    };
    
    console.log(`[${timestamp}] 保存する設定:`, JSON.stringify(settings));

    const result = await apiCall('/api/settings', 'PUT', settings);
    const messageElement = document.getElementById('settings-message');

    if (result && result.success) {
        // キャッシュも更新
        currentSettings = settings;
        console.log(`[${timestamp}] ✅ 設定を保存しました (キャッシュも更新):`, JSON.stringify(currentSettings));
        
        messageElement.textContent = '設定を保存しました';
        messageElement.className = 'message success';
    } else {
        console.error(`[${timestamp}] ❌ 設定の保存に失敗しました`);
        messageElement.textContent = '設定の保存に失敗しました';
        messageElement.className = 'message error';
    }

    setTimeout(() => {
        messageElement.textContent = '';
        messageElement.className = 'message';
    }, 3000);
}

// 自動受付停止チェック
async function checkAutoStop() {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] 🔍 自動停止チェック実行`);
    
    const result = await apiCall('/api/check-auto-stop', 'POST', { date: currentDate });
    
    if (result && result.should_stop) {
        console.log(`[${timestamp}] ⚠️ 自動受付停止が実行されました`);
        console.log(`[${timestamp}] 待機人数: ${result.waiting_people}人`);
        // キャッシュも更新
        if (currentSettings) {
            currentSettings.reception = false;
            console.log(`[${timestamp}] ❌ 設定キャッシュを更新: reception = false`);
            console.log(`[${timestamp}] 現在のキャッシュ:`, JSON.stringify(currentSettings));
        }
    } else if (result) {
        console.log(`[${timestamp}] ✅ 自動停止条件を満たしていません (待機人数: ${result.waiting_people}人)`);
    }
}

// イベントリスナー設定
document.addEventListener('DOMContentLoaded', () => {
    // ログイン
    document.getElementById('login-btn').addEventListener('click', login);
    document.getElementById('password-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') login();
    });

    // ログアウト
    document.getElementById('logout-btn').addEventListener('click', logout);

    // 更新ボタン
    document.getElementById('refresh-btn').addEventListener('click', loadCurrentTab);

    // 日付選択
    document.querySelectorAll('input[name="date"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentDate = e.target.value;
            loadCurrentTab();
        });
    });

    // タブ切り替え
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.target.dataset.tab);
        });
    });

    // グループ呼び出し
    setupDropZone();
    document.getElementById('accept-btn').addEventListener('click', acceptGroup);

    // 予約一覧
    document.getElementById('apply-filters').addEventListener('click', loadReservationList);

    // 予約追加
    setupAddReservation();
    document.getElementById('submit-reservation').addEventListener('click', submitReservation);

    // 設定
    document.getElementById('save-settings').addEventListener('click', saveSettings);

    // 初期表示
    if (authToken) {
        showMainScreen();
    } else {
        showLoginScreen();
    }
});
