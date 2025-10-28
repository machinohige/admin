// グローバル変数
const API_BASE_URL = 'https://kunugida-reservation-api-pv3b3g64na-an.a.run.app';
let authToken = null;
let currentTab = 'dashboard';
let currentDate = null;
let allReservations = [];
let updateInterval = null;
let selectedReservationId = null;

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    updateCurrentDate();
    setInterval(updateCurrentDate, 1000);
});

// 現在日時の判定
function updateCurrentDate() {
    const now = new Date();
    const dateStr = document.getElementById('currentDate');
    
    if (dateStr) {
        dateStr.textContent = now.toLocaleString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
    
    // 営業終了判定
    const nov2End = new Date('2025-11-02T17:00:00');
    if (now >= nov2End) {
        showClosedMessage();
        return;
    }
    
    // 表示する日付の決定
    const nov1Switch = new Date('2025-11-01T17:00:00');
    if (now < nov1Switch) {
        currentDate = '2025-11-01';
    } else {
        currentDate = '2025-11-02';
    }
}

// 営業終了メッセージ表示
function showClosedMessage() {
    document.getElementById('closedMessage').style.display = 'block';
    document.querySelectorAll('.tab-content').forEach(tab => {
        if (tab.id !== 'closedMessage') {
            tab.style.display = 'none';
        }
    });
    if (updateInterval) {
        clearInterval(updateInterval);
    }
}

// ログイン
async function login() {
    const password = document.getElementById('passwordInput').value;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            localStorage.setItem('adminToken', authToken);
            showMainScreen();
        } else {
            document.getElementById('loginError').style.display = 'block';
        }
    } catch (error) {
        console.error('Login error:', error);
        document.getElementById('loginError').style.display = 'block';
    }
}

// 認証チェック
function checkAuth() {
    const token = localStorage.getItem('adminToken');
    if (token) {
        authToken = token;
        showMainScreen();
    }
}

// ログアウト
function logout() {
    authToken = null;
    localStorage.removeItem('adminToken');
    document.getElementById('loginScreen').classList.add('active');
    document.getElementById('mainScreen').classList.remove('active');
    if (updateInterval) {
        clearInterval(updateInterval);
    }
}

// メイン画面表示
function showMainScreen() {
    document.getElementById('loginScreen').classList.remove('active');
    document.getElementById('mainScreen').classList.add('active');
    
    // データ取得開始
    loadDashboard();
    loadSettings();
    
    // 自動更新開始（1分ごと）
    updateInterval = setInterval(() => {
        if (currentTab === 'dashboard') {
            loadDashboard();
        }
    }, 60000);
}

// タブ切り替え
function switchTab(tabName) {
    currentTab = tabName;
    
    // タブボタンのアクティブ状態を更新
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // タブコンテンツの表示切り替え
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName + 'Tab').classList.add('active');
    
    // タブごとのデータ読み込み
    switch(tabName) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'reservations':
            loadAllReservations();
            break;
        case 'statistics':
            loadStatistics();
            break;
        case 'settings':
            loadSettings();
            break;
    }
}

// ダッシュボード読み込み
async function loadDashboard() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/dashboard?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            updateDashboard(data);
            updateLastUpdateTime();
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

// ダッシュボード更新
function updateDashboard(data) {
    // 次に呼び出すグループ
    const nextGroupNumber = document.getElementById('nextGroupNumber');
    const nextGroupReservations = document.getElementById('nextGroupReservations');
    const callGroupBtn = document.getElementById('callGroupBtn');
    
    if (data.next_group) {
        nextGroupNumber.textContent = data.next_group.group_number;
        nextGroupReservations.innerHTML = '';
        
        data.next_group.reservations.forEach(res => {
            const div = document.createElement('div');
            div.className = 'reservation-item' + (res.type === 'X' || res.type === 'Y' ? ' vip' : '');
            div.innerHTML = `
                <div class="reservation-info">
                    <span class="reservation-number">${res.reservation_id}</span>
                    <span class="reservation-details">${res.count}人 | ${res.type}</span>
                </div>
            `;
            nextGroupReservations.appendChild(div);
        });
        
        callGroupBtn.disabled = false;
    } else {
        nextGroupNumber.textContent = '-';
        nextGroupReservations.textContent = '次のグループはありません';
        callGroupBtn.disabled = true;
    }
    
    // 呼び出し中のグループ
    const callingGroupCard = document.getElementById('callingGroupCard');
    const callingGroupNumber = document.getElementById('callingGroupNumber');
    const callingGroupReservations = document.getElementById('callingGroupReservations');
    
    if (data.calling_group) {
        callingGroupCard.style.display = 'block';
        callingGroupNumber.textContent = data.calling_group.group_number;
        callingGroupReservations.innerHTML = '';
        
        data.calling_group.reservations.forEach(res => {
            const div = document.createElement('div');
            div.className = 'reservation-item' + (res.no_show_count > 0 ? ' no-show' : '');
            div.innerHTML = `
                <div class="reservation-info">
                    <span class="reservation-number">${res.reservation_id}</span>
                    <span class="reservation-details">${res.count}人 | ${res.type}</span>
                    ${res.no_show_count > 0 ? `<span class="reservation-details" style="color: #f44336;">未来店 ${res.no_show_count}回目</span>` : ''}
                </div>
                <div class="reservation-actions">
                    <button class="btn btn-success" onclick="markAsVisited('${res.reservation_id}')">来店</button>
                    <button class="btn btn-danger" onclick="markAsNoShow('${res.reservation_id}')">来ない</button>
                </div>
            `;
            callingGroupReservations.appendChild(div);
        });
    } else {
        callingGroupCard.style.display = 'none';
    }
    
    // 次の予約リスト
    updateUpcomingList('upcomingReserved', data.upcoming_reserved || []);
    updateUpcomingList('upcomingWalkIn', data.upcoming_walkin || []);
    updateUpcomingList('upcomingVip', data.upcoming_vip || []);
    
    // 呼び出し済み・未来店
    updateCalledNoShowList(data.called_no_show || []);
}

// 次の予約リスト更新
function updateUpcomingList(elementId, reservations) {
    const container = document.getElementById(elementId);
    
    if (reservations.length === 0) {
        container.innerHTML = '<p class="empty-state">予約なし</p>';
        return;
    }
    
    container.innerHTML = '';
    reservations.slice(0, 5).forEach(res => {
        const div = document.createElement('div');
        div.className = 'reservation-list-item' + (res.type === 'X' || res.type === 'Y' ? ' vip' : '');
        div.innerHTML = `
            <strong>${res.reservation_id}</strong>
            ${res.count}人 | GROUP ${res.group}
            ${res.time ? `| ${res.time}` : ''}
        `;
        container.appendChild(div);
    });
}

// 呼び出し済み・未来店リスト更新
function updateCalledNoShowList(reservations) {
    const container = document.getElementById('calledNoShow');
    
    if (reservations.length === 0) {
        container.innerHTML = '<p class="empty-state">該当なし</p>';
        return;
    }
    
    container.innerHTML = '';
    reservations.forEach(res => {
        const div = document.createElement('div');
        div.className = 'called-item';
        
        const firstCallTime = new Date(res.first_call_time);
        const now = new Date();
        const minutesAgo = Math.floor((now - firstCallTime) / 60000);
        
        div.innerHTML = `
            <div>
                <strong>${res.reservation_id}</strong>
                <span class="reservation-details">${res.count}人 | ${res.type}</span>
            </div>
            <div class="called-time">
                初回呼び出し: ${minutesAgo}分前
            </div>
        `;
        container.appendChild(div);
    });
}

// 最終更新時刻表示
function updateLastUpdateTime() {
    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
        const now = new Date();
        lastUpdate.textContent = `最終更新: ${now.toLocaleTimeString('ja-JP')}`;
    }
}

// グループ呼び出し
async function callNextGroup() {
    if (!confirm('このグループを呼び出しますか？')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/call-group`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ date: currentDate })
        });
        
        if (response.ok) {
            loadDashboard();
        } else {
            alert('グループの呼び出しに失敗しました');
        }
    } catch (error) {
        console.error('Error calling group:', error);
        alert('グループの呼び出しに失敗しました');
    }
}

// 来店確認
async function markAsVisited(reservationId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations/${reservationId}/visit`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            loadDashboard();
        } else {
            alert('来店確認に失敗しました');
        }
    } catch (error) {
        console.error('Error marking as visited:', error);
        alert('来店確認に失敗しました');
    }
}

// 未来店マーク
async function markAsNoShow(reservationId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations/${reservationId}/no-show`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            loadDashboard();
        } else {
            alert('未来店マークに失敗しました');
        }
    } catch (error) {
        console.error('Error marking as no-show:', error);
        alert('未来店マークに失敗しました');
    }
}

// 全予約読み込み
async function loadAllReservations() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            allReservations = data.reservations || [];
            displayReservations(allReservations);
        }
    } catch (error) {
        console.error('Error loading reservations:', error);
    }
}

// 予約検索
function searchReservations() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const typeFilter = document.getElementById('typeFilter').value;
    
    let filtered = allReservations;
    
    if (searchTerm) {
        filtered = filtered.filter(res => 
            res.reservation_id.toLowerCase().includes(searchTerm)
        );
    }
    
    if (statusFilter) {
        filtered = filtered.filter(res => res.status === parseInt(statusFilter));
    }
    
    if (typeFilter) {
        filtered = filtered.filter(res => res.type === typeFilter);
    }
    
    displayReservations(filtered);
}

// 予約表示
function displayReservations(reservations) {
    const tbody = document.getElementById('reservationsTableBody');
    
    if (reservations.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">予約が見つかりません</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    reservations.forEach(res => {
        const tr = document.createElement('tr');
        
        const statusText = res.status === 0 ? '予約受付' : res.status === 1 ? '来店済み' : 'キャンセル';
        const statusClass = res.status === 0 ? 'active' : res.status === 1 ? 'completed' : 'cancelled';
        
        tr.innerHTML = `
            <td><strong>${res.reservation_id}</strong></td>
            <td>${res.type}</td>
            <td>${res.count}人</td>
            <td>${res.group || '-'}</td>
            <td>${res.time || '-'}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${new Date(res.created_at).toLocaleString('ja-JP')}</td>
            <td>
                <button class="btn" onclick="showReservationDetail('${res.reservation_id}')">詳細</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// 予約詳細表示
function showReservationDetail(reservationId) {
    const reservation = allReservations.find(r => r.reservation_id === reservationId);
    if (!reservation) return;
    
    selectedReservationId = reservationId;
    
    const modalContent = document.getElementById('modalContent');
    const statusText = reservation.status === 0 ? '予約受付' : reservation.status === 1 ? '来店済み' : 'キャンセル';
    
    modalContent.innerHTML = `
        <div class="form-grid">
            <div class="form-group">
                <label>予約番号</label>
                <input type="text" value="${reservation.reservation_id}" readonly>
            </div>
            <div class="form-group">
                <label>タイプ</label>
                <input type="text" value="${reservation.type}" readonly>
            </div>
            <div class="form-group">
                <label>人数</label>
                <input type="text" value="${reservation.count}人" readonly>
            </div>
            <div class="form-group">
                <label>グループ</label>
                <input type="text" value="${reservation.group || '-'}" readonly>
            </div>
            <div class="form-group">
                <label>時間</label>
                <input type="text" value="${reservation.time || '-'}" readonly>
            </div>
            <div class="form-group">
                <label>ステータス</label>
                <input type="text" value="${statusText}" readonly>
            </div>
            <div class="form-group">
                <label>作成日時</label>
                <input type="text" value="${new Date(reservation.created_at).toLocaleString('ja-JP')}" readonly>
            </div>
        </div>
    `;
    
    document.getElementById('reservationModal').classList.add('active');
}

// モーダルを閉じる
function closeModal() {
    document.getElementById('reservationModal').classList.remove('active');
    selectedReservationId = null;
}

// 予約キャンセル
async function cancelReservation() {
    if (!selectedReservationId) return;
    
    if (!confirm('この予約をキャンセルしますか？')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations/${selectedReservationId}/cancel`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            closeModal();
            loadAllReservations();
            alert('予約をキャンセルしました');
        } else {
            alert('キャンセルに失敗しました');
        }
    } catch (error) {
        console.error('Error cancelling reservation:', error);
        alert('キャンセルに失敗しました');
    }
}

// 時間入力の表示切り替え
function toggleTimeInput() {
    const type = document.getElementById('newResType').value;
    const timeGroup = document.getElementById('timeInputGroup');
    
    if (type === 'X' || type === 'Y') {
        timeGroup.style.display = 'block';
        document.getElementById('newResTime').required = true;
    } else {
        timeGroup.style.display = 'none';
        document.getElementById('newResTime').required = false;
    }
}

// 手動予約作成
async function createManualReservation() {
    const type = document.getElementById('newResType').value;
    const count = document.getElementById('newResCount').value;
    const time = document.getElementById('newResTime').value;
    
    if (!type || !count) {
        alert('必須項目を入力してください');
        return;
    }
    
    if ((type === 'X' || type === 'Y') && !time) {
        alert('関係者予約には時刻を指定してください');
        return;
    }
    
    const requestData = {
        type: type,
        count: parseInt(count),
        date: type === 'C' || type === 'X' ? '2025-11-01' : '2025-11-02'
    };
    
    if (type === 'X' || type === 'Y') {
        requestData.time = time;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('newResSuccess').style.display = 'block';
            document.getElementById('newResNumber').textContent = data.reservation_id;
            document.getElementById('newResError').style.display = 'none';
            document.getElementById('newReservationForm').reset();
            toggleTimeInput();
            
            setTimeout(() => {
                document.getElementById('newResSuccess').style.display = 'none';
            }, 5000);
        } else {
            document.getElementById('newResError').textContent = data.error || '予約の作成に失敗しました';
            document.getElementById('newResError').style.display = 'block';
            document.getElementById('newResSuccess').style.display = 'none';
        }
    } catch (error) {
        console.error('Error creating reservation:', error);
        document.getElementById('newResError').textContent = '予約の作成に失敗しました';
        document.getElementById('newResError').style.display = 'block';
    }
}

// 統計情報読み込み
async function loadStatistics() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/statistics?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            updateStatistics(data);
        }
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

// 統計情報更新
function updateStatistics(data) {
    document.getElementById('statTotalReservations').textContent = data.total || 0;
    document.getElementById('statVisited').textContent = data.visited || 0;
    document.getElementById('statCancelled').textContent = data.cancelled || 0;
    document.getElementById('statWaiting').textContent = data.waiting || 0;
    
    // タイプ別グラフ
    const typeCtx = document.getElementById('typeChart');
    if (typeCtx && data.by_type) {
        new Chart(typeCtx, {
            type: 'bar',
            data: {
                labels: Object.keys(data.by_type),
                datasets: [{
                    label: '予約数',
                    data: Object.values(data.by_type),
                    backgroundColor: '#000000',
                    borderColor: '#000000',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        });
    }
    
    // 時間別グラフ
    const timeCtx = document.getElementById('timeChart');
    if (timeCtx && data.by_hour) {
        new Chart(timeCtx, {
            type: 'line',
            data: {
                labels: Object.keys(data.by_hour),
                datasets: [{
                    label: '来店数',
                    data: Object.values(data.by_hour),
                    backgroundColor: 'rgba(0, 0, 0, 0.1)',
                    borderColor: '#000000',
                    borderWidth: 2,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        });
    }
}

// 設定読み込み
async function loadSettings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/settings`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('settingReception').checked = data.reception || false;
            document.getElementById('settingJoukyou').checked = data.joukyou || false;
            document.getElementById('settingJidou').checked = data.jidou || false;
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// 設定更新
async function updateSetting(key) {
    const value = document.getElementById('setting' + key.charAt(0).toUpperCase() + key.slice(1)).checked;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/settings`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                key: key,
                value: value
            })
        });
        
        if (!response.ok) {
            alert('設定の更新に失敗しました');
            loadSettings(); // 元に戻す
        }
    } catch (error) {
        console.error('Error updating setting:', error);
        alert('設定の更新に失敗しました');
        loadSettings();
    }
}
