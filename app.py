from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime, timedelta
import os
import jwt
from functools import wraps

app = Flask(__name__)
CORS(app)

# 環境変数
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')
JWT_SECRET = os.environ.get('JWT_SECRET', 'simple-secret-key')

# Firebase初期化
db = None
try:
    import firebase_admin
    from firebase_admin import credentials, firestore
    
    if os.path.exists('firebase-key.json'):
        cred = credentials.Certificate('firebase-key.json')
        firebase_admin.initialize_app(cred)
        db = firestore.client()
        print("✅ Firebase OK")
    else:
        print("❌ No firebase-key.json")
except Exception as e:
    print(f"❌ Firebase error: {e}")

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if db is None:
            return jsonify({'error': 'DB not ready'}), 503
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({'error': 'No token'}), 401
        try:
            jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        except:
            return jsonify({'error': 'Bad token'}), 401
        return f(*args, **kwargs)
    return decorated

@app.route('/')
def home():
    return jsonify({'status': 'ok', 'db': db is not None})

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

@app.route('/api/admin/login', methods=['POST'])
def login():
    try:
        data = request.json or {}
        if data.get('password') == ADMIN_PASSWORD:
            token = jwt.encode({'exp': datetime.utcnow() + timedelta(days=7)}, JWT_SECRET, algorithm='HS256')
            return jsonify({'token': token})
        return jsonify({'error': 'Wrong password'}), 401
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 次に呼び出すグループを取得
@app.route('/api/admin/next-group', methods=['GET'])
@require_auth
def get_next_group():
    try:
        date = request.args.get('date', '2025-11-01')
        group_collection = 'group' if date == '2025-11-01' else 'group2'
        
        # 時間指定予約（X/Y）で呼び出し時刻になっているものをチェック
        now = datetime.now()
        current_time = now.strftime('%H:%M')
        
        # 5分前になった関係者予約を探す
        all_res = db.collection('reservation').stream()
        vip_ready = []
        
        for doc in all_res:
            res_id = doc.id
            data = doc.to_dict()
            res_type = res_id[0] if len(res_id) > 0 else 'X'
            
            # 関係者予約（X/Y）のみ
            if res_type not in ['X', 'Y']:
                continue
            
            # 日付チェック
            if data.get('date') != date:
                continue
            
            # ステータスチェック（status=0のみ）
            if data.get('status', 0) != 0:
                continue
            
            # 時刻チェック
            res_time = data.get('time')
            if res_time:
                # 5分前かチェック
                res_datetime = datetime.strptime(f"{date} {res_time}", '%Y-%m-%d %H:%M')
                call_time = res_datetime - timedelta(minutes=5)
                
                if now >= call_time and not data.get('group'):
                    vip_ready.append({
                        'id': res_id,
                        'time': res_time,
                        'count': data.get('count', 0)
                    })
        
        # 関係者予約をグループに割り当て
        for vip in vip_ready:
            assign_vip_to_group(vip['id'], vip['count'], group_collection)
        
        # 不在マークされた予約（priority=True）を取得
        priority_reservations = []
        all_res2 = db.collection('reservation').stream()
        
        for doc in all_res2:
            res_id = doc.id
            data = doc.to_dict()
            res_type = res_id[0] if len(res_id) > 0 else 'X'
            
            # 日付判定
            if data.get('date'):
                res_date = data['date']
            else:
                res_date = '2025-11-01' if res_type in ['A', 'C', 'X'] else '2025-11-02'
            
            if res_date != date:
                continue
            
            # priority=Trueかつstatus=0の予約
            if data.get('priority', False) and data.get('status', 0) == 0:
                priority_reservations.append({
                    'id': res_id,
                    'count': data.get('count', 0),
                    'type': res_type
                })
        
        # 優先予約がある場合、次のグループに追加
        if priority_reservations:
            next_group_num = create_priority_group(priority_reservations, group_collection)
            if next_group_num:
                # 作成したグループの情報を返す
                group_doc = db.collection(group_collection).document(str(next_group_num)).get()
                if group_doc.exists:
                    group_data = group_doc.to_dict()
                    reservations = []
                    
                    for res_id in group_data.get('reservation', []):
                        res_doc = db.collection('reservation').document(res_id).get()
                        if res_doc.exists:
                            res_data = res_doc.to_dict()
                            if res_data.get('status', 0) == 0:
                                reservations.append({
                                    'reservation_id': res_id,
                                    'count': res_data.get('count', 0),
                                    'type': res_id[0] if len(res_id) > 0 else 'X',
                                    'time': res_data.get('time'),
                                    'status': res_data.get('status', 0),
                                    'priority': res_data.get('priority', False)
                                })
                    
                    if reservations:
                        return jsonify({
                            'group_number': next_group_num,
                            'reservations': reservations,
                            'has_priority': True
                        })
        
        # 次に呼び出すグループを取得
        groups = db.collection(group_collection).order_by('__name__').stream()
        
        for group_doc in groups:
            group_num = int(group_doc.id)
            group_data = group_doc.to_dict()
            
            # status=0（待機中）のグループのみ
            if group_data.get('status', 0) != 0:
                continue
            
            # このグループの予約情報を取得
            reservations = []
            reservation_ids = group_data.get('reservation', [])
            has_priority = False
            
            for res_id in reservation_ids:
                res_doc = db.collection('reservation').document(res_id).get()
                if res_doc.exists:
                    res_data = res_doc.to_dict()
                    # status=0（待機中）またはstatus=3（不在マーク、優先あり）のみ
                    if res_data.get('status', 0) == 0:
                        if res_data.get('priority', False):
                            has_priority = True
                        reservations.append({
                            'reservation_id': res_id,
                            'count': res_data.get('count', 0),
                            'type': res_id[0] if len(res_id) > 0 else 'X',
                            'time': res_data.get('time'),
                            'status': res_data.get('status', 0),
                            'priority': res_data.get('priority', False)
                        })
            
            if reservations:
                # 優先予約がある場合は最優先で返す
                return jsonify({
                    'group_number': group_num,
                    'reservations': reservations,
                    'has_priority': has_priority
                })
        
        return jsonify({'group_number': None, 'reservations': []})
    except Exception as e:
        print(f"Error in get_next_group: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# グループを呼び出し中にする
@app.route('/api/admin/call-group', methods=['POST'])
@require_auth
def call_group():
    try:
        data = request.json or {}
        date = data.get('date', '2025-11-01')
        group_number = data.get('group_number')
        
        if not group_number:
            return jsonify({'error': 'group_number required'}), 400
        
        group_collection = 'group' if date == '2025-11-01' else 'group2'
        
        # グループのステータスを1（呼び出し中）に更新
        db.collection(group_collection).document(str(group_number)).update({
            'status': 1,
            'called_at': datetime.now().isoformat()
        })
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error in call_group: {e}")
        return jsonify({'error': str(e)}), 500

# グループを待機中に戻す
@app.route('/api/admin/reset-group', methods=['POST'])
@require_auth
def reset_group():
    try:
        data = request.json or {}
        date = data.get('date', '2025-11-01')
        group_number = data.get('group_number')
        
        if not group_number:
            return jsonify({'error': 'group_number required'}), 400
        
        group_collection = 'group' if date == '2025-11-01' else 'group2'
        
        # グループのステータスを0（待機中）に戻す
        db.collection(group_collection).document(str(group_number)).update({
            'status': 0
        })
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error in reset_group: {e}")
        return jsonify({'error': str(e)}), 500

# 優先予約用のグループを作成
def create_priority_group(priority_reservations, group_collection):
    try:
        # 既存のグループ番号を取得
        groups = db.collection(group_collection).stream()
        existing_nums = set()
        
        for group_doc in groups:
            try:
                num = int(group_doc.id)
                existing_nums.add(num)
            except ValueError:
                continue
        
        # 新しいグループ番号を決定（既存と重複しない）
        if not existing_nums:
            new_group_num = 1
        else:
            new_group_num = max(existing_nums) + 1
            # 既存の番号と重複する場合はさらに+1
            while new_group_num in existing_nums:
                new_group_num += 1
        
        # 優先予約を4人以下になるように組み合わせる
        current_group_reservations = []
        current_count = 0
        
        for res in priority_reservations:
            if current_count + res['count'] <= 4:
                current_group_reservations.append(res['id'])
                current_count += res['count']
                
                # グループ番号を更新
                db.collection('reservation').document(res['id']).update({
                    'group': new_group_num
                })
        
        # グループが空でない場合のみ作成
        if current_group_reservations:
            db.collection(group_collection).document(str(new_group_num)).set({
                'status': 0,
                'reservation': current_group_reservations,
                'created_at': datetime.now().isoformat(),
                'is_priority': True
            })
            
            print(f"Created priority group {new_group_num} with {len(current_group_reservations)} reservations")
            return new_group_num
        
        return None
    except Exception as e:
        print(f"Error creating priority group: {e}")
        import traceback
        traceback.print_exc()
        return None

# 呼び出し中のグループを取得
@app.route('/api/admin/calling-group', methods=['GET'])
@require_auth
def get_calling_group():
    try:
        date = request.args.get('date', '2025-11-01')
        group_collection = 'group' if date == '2025-11-01' else 'group2'
        
        groups = db.collection(group_collection).stream()
        
        for group_doc in groups:
            group_num = int(group_doc.id)
            group_data = group_doc.to_dict()
            
            # status=1（呼び出し中）のグループのみ
            if group_data.get('status', 0) != 1:
                continue
            
            # このグループの予約情報を取得
            reservations = []
            reservation_ids = group_data.get('reservation', [])
            
            for res_id in reservation_ids:
                res_doc = db.collection('reservation').document(res_id).get()
                if res_doc.exists:
                    res_data = res_doc.to_dict()
                    reservations.append({
                        'reservation_id': res_id,
                        'count': res_data.get('count', 0),
                        'type': res_id[0] if len(res_id) > 0 else 'X',
                        'time': res_data.get('time'),
                        'status': res_data.get('status', 0),
                        'priority': res_data.get('priority', False)
                    })
            
            return jsonify({
                'group_number': group_num,
                'reservations': reservations
            })
        
        return jsonify({'group_number': None, 'reservations': []})
    except Exception as e:
        print(f"Error in get_calling_group: {e}")
        return jsonify({'error': str(e)}), 500

# 予約を来店済みにする
@app.route('/api/admin/reservations/<res_id>/visit', methods=['POST'])
@require_auth
def mark_visit(res_id):
    try:
        # status=1（来店済み）にして、priorityフラグをクリア
        db.collection('reservation').document(res_id).update({
            'status': 1,
            'priority': False
        })
        
        # このグループの全予約をチェック
        check_and_complete_group(res_id)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 予約を不在にする
@app.route('/api/admin/reservations/<res_id>/absent', methods=['POST'])
@require_auth
def mark_absent(res_id):
    try:
        # status=3（不在）にマーク、優先フラグを付与
        db.collection('reservation').document(res_id).update({
            'status': 3,
            'priority': True,
            'absent_at': datetime.now().isoformat()
        })
        
        # 空いた枠を補充
        fill_vacant_slot(res_id)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 空いた枠を補充する
def fill_vacant_slot(absent_res_id):
    try:
        # 不在になった予約の情報を取得
        absent_doc = db.collection('reservation').document(absent_res_id).get()
        if not absent_doc.exists:
            return
        
        absent_data = absent_doc.to_dict()
        absent_count = absent_data.get('count', 0)
        group_num = absent_data.get('group')
        
        if not group_num:
            return
        
        # 日付を判定
        res_type = absent_res_id[0] if len(absent_res_id) > 0 else 'X'
        date = '2025-11-01' if res_type in ['A', 'C', 'X'] else '2025-11-02'
        group_collection = 'group' if date == '2025-11-01' else 'group2'
        
        # このグループの情報を取得
        group_doc = db.collection(group_collection).document(str(group_num)).get()
        if not group_doc.exists:
            return
        
        group_data = group_doc.to_dict()
        
        # グループが呼び出し中でない場合は何もしない
        if group_data.get('status', 0) != 1:
            return
        
        # 後ろのグループから補充候補を探す
        all_reservations = db.collection('reservation').stream()
        candidates = []
        
        for doc in all_reservations:
            r_id = doc.id
            r_data = doc.to_dict()
            r_type = r_id[0] if len(r_id) > 0 else 'X'
            
            # 日付チェック
            if r_data.get('date'):
                r_date = r_data['date']
            else:
                r_date = '2025-11-01' if r_type in ['A', 'C', 'X'] else '2025-11-02'
            
            if r_date != date:
                continue
            
            # status=0（待機中）のみ
            if r_data.get('status', 0) != 0:
                continue
            
            # グループが割り当てられている
            r_group = r_data.get('group')
            if not r_group:
                continue
            
            # 現在のグループより後ろのグループ
            if r_group <= group_num:
                continue
            
            # 人数が空き枠以下
            r_count = r_data.get('count', 0)
            if r_count <= absent_count:
                candidates.append({
                    'id': r_id,
                    'count': r_count,
                    'group': r_group,
                    'priority': r_data.get('priority', False),
                    'type': r_type
                })
        
        if not candidates:
            # 補充候補がない場合、グループのチェック
            check_and_complete_group(absent_res_id)
            return
        
        # 優先フラグがあるものを優先、次にグループ番号が小さいものを選択
        candidates.sort(key=lambda x: (not x['priority'], x['group'], x['id']))
        selected = candidates[0]
        
        # 選択された予約を現在のグループに移動
        db.collection('reservation').document(selected['id']).update({
            'group': group_num,
            'priority': False  # 優先フラグをクリア
        })
        
        # 元のグループから削除
        old_group_doc = db.collection(group_collection).document(str(selected['group'])).get()
        if old_group_doc.exists:
            old_group_data = old_group_doc.to_dict()
            old_reservations = old_group_data.get('reservation', [])
            if selected['id'] in old_reservations:
                old_reservations.remove(selected['id'])
                db.collection(group_collection).document(str(selected['group'])).update({
                    'reservation': old_reservations
                })
        
        # 新しいグループに追加
        current_reservations = group_data.get('reservation', [])
        if selected['id'] not in current_reservations:
            current_reservations.append(selected['id'])
            db.collection(group_collection).document(str(group_num)).update({
                'reservation': current_reservations
            })
        
        print(f"Filled vacant slot: moved {selected['id']} to group {group_num}")
        
    except Exception as e:
        print(f"Error in fill_vacant_slot: {e}")
        import traceback
        traceback.print_exc()

# グループが完了したかチェック
def check_and_complete_group(res_id):
    try:
        # この予約が所属するグループを探す
        res_doc = db.collection('reservation').document(res_id).get()
        if not res_doc.exists:
            return
        
        group_num = res_doc.to_dict().get('group')
        if not group_num:
            return
        
        # 日付を判定
        res_type = res_id[0] if len(res_id) > 0 else 'X'
        date = '2025-11-01' if res_type in ['A', 'C', 'X'] else '2025-11-02'
        group_collection = 'group' if date == '2025-11-01' else 'group2'
        
        # グループ情報を取得
        group_doc = db.collection(group_collection).document(str(group_num)).get()
        if not group_doc.exists:
            return
        
        group_data = group_doc.to_dict()
        
        # グループが呼び出し中でない場合は何もしない
        if group_data.get('status', 0) != 1:
            return
        
        # グループ内の全予約をチェック
        reservation_ids = group_data.get('reservation', [])
        all_processed = True
        
        for r_id in reservation_ids:
            r_doc = db.collection('reservation').document(r_id).get()
            if r_doc.exists:
                r_status = r_doc.to_dict().get('status', 0)
                # status=0（待機中）がある場合は未完了
                if r_status == 0:
                    all_processed = False
                    break
        
        # 全て処理済み（来店 or 不在）の場合、グループを完了
        if all_processed:
            db.collection(group_collection).document(str(group_num)).update({
                'status': 2,  # 完了
                'completed_at': datetime.now().isoformat()
            })
    except Exception as e:
        print(f"Error in check_and_complete_group: {e}")

# 関係者予約をグループに割り当て
def assign_vip_to_group(reservation_id, count, group_collection):
    try:
        # 既存のグループを取得
        groups = db.collection(group_collection).stream()
        group_list = []
        
        for group_doc in groups:
            try:
                group_num = int(group_doc.id)
                group_data = group_doc.to_dict()
                
                # ステータスが0のグループのみ
                if group_data.get('status', 0) != 0:
                    continue
                
                # このグループの現在の人数を計算
                current_reservations = group_data.get('reservation', [])
                current_count = 0
                
                for r_id in current_reservations:
                    r_doc = db.collection('reservation').document(r_id).get()
                    if r_doc.exists:
                        current_count += r_doc.to_dict().get('count', 0)
                
                group_list.append({
                    'number': group_num,
                    'current_count': current_count,
                    'reservations': current_reservations
                })
            except ValueError:
                continue
        
        # グループ番号でソート
        group_list.sort(key=lambda x: x['number'])
        
        # 4人以下で収まるグループを探す
        for group in group_list:
            if group['current_count'] + count <= 4:
                # このグループに追加
                group['reservations'].append(reservation_id)
                db.collection(group_collection).document(str(group['number'])).update({
                    'reservation': group['reservations']
                })
                db.collection('reservation').document(reservation_id).update({
                    'group': group['number']
                })
                return group['number']
        
        # 既存のグループに入らない場合、新しいグループを作成
        new_group_num = get_next_available_group_number(group_collection)
        db.collection(group_collection).document(str(new_group_num)).set({
            'status': 0,
            'reservation': [reservation_id]
        })
        db.collection('reservation').document(reservation_id).update({
            'group': new_group_num
        })
        
        return new_group_num
    except Exception as e:
        print(f"Error in assign_vip_to_group: {e}")
        return 1

# 次の利用可能なグループ番号を取得
def get_next_available_group_number(group_collection):
    try:
        groups = db.collection(group_collection).stream()
        existing_nums = set()
        
        for group_doc in groups:
            try:
                num = int(group_doc.id)
                existing_nums.add(num)
            except ValueError:
                continue
        
        # 既存の番号がない場合
        if not existing_nums:
            return 1
        
        # 最大値+1を返す（既存と重複しない）
        new_num = max(existing_nums) + 1
        
        # 念のため既存と重複する場合はさらに+1
        while new_num in existing_nums:
            new_num += 1
        
        return new_num
    except Exception as e:
        print(f"Error getting next group number: {e}")
        return 1

@app.route('/api/admin/dashboard', methods=['GET'])
@require_auth
def dashboard():
    try:
        date = request.args.get('date', '2025-11-01')
        return jsonify({
            'next_group': None,
            'calling_group': None,
            'upcoming_reserved': [],
            'upcoming_walkin': [],
            'upcoming_vip': [],
            'called_no_show': []
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/reservations', methods=['GET'])
@require_auth
def get_reservations():
    try:
        date = request.args.get('date', '2025-11-01')
        print(f"=== Get Reservations for date: {date} ===")
        result = []
        
        all_res = db.collection('reservation').stream()
        total_count = 0
        matched_count = 0
        
        for doc in all_res:
            total_count += 1
            res_id = doc.id
            data = doc.to_dict()
            
            # タイプ判定
            res_type = res_id[0] if len(res_id) > 0 else 'X'
            
            # 日付判定
            if data.get('date'):
                res_date = data['date']
            else:
                res_date = '2025-11-01' if res_type in ['A', 'C', 'X'] else '2025-11-02'
            
            print(f"  Reservation {res_id}: type={res_type}, date={res_date}, status={data.get('status')}")
            
            # 日付フィルタ
            if res_date != date:
                continue
            
            matched_count += 1
            result.append({
                'reservation_id': res_id,
                'type': res_type,
                'count': data.get('count', 0),
                'group': data.get('group'),
                'status': data.get('status', 0),
                'created_at': data.get('created_at', ''),
                'time': data.get('time'),
                'date': res_date,
                'priority': data.get('priority', False)
            })
        
        print(f"Total reservations: {total_count}, Matched: {matched_count}")
        
        # ソート
        result.sort(key=lambda x: (x.get('group') or 9999, x.get('created_at', '')))
        
        return jsonify({'reservations': result})
    except Exception as e:
        print(f"Error in get_reservations: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/reservations/<res_id>/cancel', methods=['POST'])
@require_auth
def mark_cancel(res_id):
    try:
        db.collection('reservation').document(res_id).update({'status': 2})
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 予約作成
@app.route('/api/admin/reservations/create', methods=['POST'])
@require_auth
def create_reservation():
    try:
        data = request.json or {}
        res_type = data.get('type')
        count = data.get('count')
        date = data.get('date')
        time = data.get('time')
        
        if not all([res_type, count, date]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        # 予約番号を生成
        reservation_id = generate_reservation_id(res_type, date)
        
        # 予約データを作成
        reservation_data = {
            'count': int(count),
            'status': 0,
            'created_at': datetime.now().isoformat()
        }
        
        # 関係者予約の場合
        if res_type in ['X', 'Y']:
            if not time:
                return jsonify({'error': 'Time required for VIP'}), 400
            reservation_data['date'] = date
            reservation_data['time'] = time
            # グループは時刻の5分前に自動割り当て
        else:
            # 通常予約・当日予約の場合はグループを割り当て
            group_collection = 'group' if date == '2025-11-01' else 'group2'
            group_num = assign_to_group(reservation_id, int(count), res_type, group_collection)
            reservation_data['group'] = group_num
        
        # Firestoreに保存
        db.collection('reservation').document(reservation_id).set(reservation_data)
        
        return jsonify({'success': True, 'reservation_id': reservation_id})
    except Exception as e:
        print(f"Create reservation error: {e}")
        return jsonify({'error': str(e)}), 500

# 予約番号生成
def generate_reservation_id(res_type, date):
    try:
        all_res = db.collection('reservation').stream()
        max_number = 0
        
        for doc in all_res:
            res_id = doc.id
            if res_id.startswith(res_type):
                try:
                    number = int(res_id[1:])
                    max_number = max(max_number, number)
                except ValueError:
                    continue
        
        return f"{res_type}{(max_number + 1):04d}"
    except Exception as e:
        print(f"Error generating ID: {e}")
        return f"{res_type}0001"

# グループ割り当て
def assign_to_group(reservation_id, count, res_type, group_collection):
    try:
        is_reserved = res_type in ['A', 'B']  # 事前予約
        
        # 既存のグループを取得
        groups = db.collection(group_collection).stream()
        group_list = []
        
        for group_doc in groups:
            try:
                group_num = int(group_doc.id)
                group_data = group_doc.to_dict()
                
                # ステータスが0のグループのみ
                if group_data.get('status', 0) != 0:
                    continue
                
                # 優先チェック: 奇数=事前予約, 偶数=当日来店
                if is_reserved and group_num % 2 == 0:
                    continue
                if not is_reserved and group_num % 2 == 1:
                    continue
                
                # このグループの現在の人数を計算
                current_reservations = group_data.get('reservation', [])
                current_count = 0
                
                for r_id in current_reservations:
                    r_doc = db.collection('reservation').document(r_id).get()
                    if r_doc.exists:
                        current_count += r_doc.to_dict().get('count', 0)
                
                group_list.append({
                    'number': group_num,
                    'current_count': current_count,
                    'reservations': current_reservations
                })
            except ValueError:
                continue
        
        # グループ番号でソート
        group_list.sort(key=lambda x: x['number'])
        
        # 4人以下で収まるグループを探す
        for group in group_list:
            if group['current_count'] + count <= 4:
                # このグループに追加
                group['reservations'].append(reservation_id)
                db.collection(group_collection).document(str(group['number'])).update({
                    'reservation': group['reservations']
                })
                return group['number']
        
        # 既存のグループに入らない場合、新しいグループを作成
        new_group_num = get_next_group_number(group_collection, is_reserved)
        db.collection(group_collection).document(str(new_group_num)).set({
            'status': 0,
            'reservation': [reservation_id]
        })
        
        return new_group_num
    except Exception as e:
        print(f"Error in assign_to_group: {e}")
        return 1

# 次のグループ番号を取得
def get_next_group_number(group_collection, is_reserved):
    try:
        groups = db.collection(group_collection).stream()
        existing_nums = set()
        
        for group_doc in groups:
            try:
                num = int(group_doc.id)
                existing_nums.add(num)
            except ValueError:
                continue
        
        # 既存の番号がない場合
        if not existing_nums:
            return 1 if is_reserved else 2
        
        max_num = max(existing_nums)
        
        # 次の番号を計算（奇数or偶数を維持し、既存と重複しない）
        next_num = max_num + 1
        
        # 奇数グループ（事前予約）が必要な場合
        if is_reserved:
            if next_num % 2 == 0:
                next_num += 1
        # 偶数グループ（当日来店）が必要な場合
        else:
            if next_num % 2 == 1:
                next_num += 1
        
        # 既存の番号と重複する場合はさらに+2
        while next_num in existing_nums:
            next_num += 2
        
        return next_num
    except Exception as e:
        print(f"Error getting next group number: {e}")
        return 1 if is_reserved else 2

@app.route('/api/admin/statistics', methods=['GET'])
@require_auth
def statistics():
    try:
        date = request.args.get('date', '2025-11-01')
        
        total = 0
        visited = 0
        cancelled = 0
        waiting = 0
        by_type = {}
        
        all_res = db.collection('reservation').stream()
        for doc in all_res:
            res_id = doc.id
            data = doc.to_dict()
            
            res_type = res_id[0] if len(res_id) > 0 else 'X'
            if data.get('date'):
                res_date = data['date']
            else:
                res_date = '2025-11-01' if res_type in ['A', 'C', 'X'] else '2025-11-02'
            
            if res_date != date:
                continue
            
            total += 1
            status = data.get('status', 0)
            
            if status == 1:
                visited += 1
            elif status == 2:
                cancelled += 1
            else:
                waiting += 1
            
            by_type[res_type] = by_type.get(res_type, 0) + 1
        
        return jsonify({
            'total': total,
            'visited': visited,
            'cancelled': cancelled,
            'waiting': waiting,
            'by_type': by_type,
            'by_hour': {}
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/settings', methods=['GET'])
@require_auth
def get_settings():
    try:
        doc = db.collection('settings').document('base').get()
        if doc.exists:
            data = doc.to_dict()
            return jsonify({
                'reception': data.get('reception', False),
                'joukyou': data.get('joukyou', False),
                'jidou': data.get('jidou', False)
            })
        return jsonify({'reception': False, 'joukyou': False, 'jidou': False})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/settings', methods=['POST'])
@require_auth
def update_settings():
    try:
        data = request.json or {}
        key = data.get('key')
        value = data.get('value')
        
        if not key:
            return jsonify({'error': 'No key'}), 400
        
        db.collection('settings').document('base').set({key: value}, merge=True)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    print(f"Starting on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
