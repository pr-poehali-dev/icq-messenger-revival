"""
ICQ Messages: отправка, получение истории, список диалогов, отметка прочитанными.
"""
import json
import os
import psycopg2

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-User-Id',
}

def get_db():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def get_user_by_token(cur, token):
    cur.execute(
        "SELECT u.id, u.uin FROM icq_sessions s JOIN icq_users u ON s.user_id=u.id WHERE s.token=%s AND s.expires_at > NOW()",
        (token,)
    )
    return cur.fetchone()

def handler(event: dict, context) -> dict:
    """Сообщения ICQ: история чата, отправка, список диалогов"""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'GET')
    path = event.get('path', '/')
    headers_in = event.get('headers', {})
    token = headers_in.get('X-Auth-Token') or headers_in.get('x-auth-token', '')

    if not token:
        return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Нет токена'})}

    db = get_db()
    cur = db.cursor()
    me = get_user_by_token(cur, token)
    if not me:
        cur.close()
        db.close()
        return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Сессия истекла'})}
    
    my_id = me[0]

    # GET /dialogs — список диалогов
    if method == 'GET' and '/dialogs' in path:
        cur.execute("""
            SELECT DISTINCT ON (other_id)
                other_id,
                u.uin, u.nickname, u.first_name, u.last_name, u.status, u.avatar_url,
                last_msg.content, last_msg.sent_at, last_msg.sender_id,
                (SELECT COUNT(*) FROM icq_messages WHERE receiver_id=%s AND sender_id=other_id AND is_read=FALSE) as unread
            FROM (
                SELECT CASE WHEN sender_id=%s THEN receiver_id ELSE sender_id END as other_id,
                       id, content, sent_at, sender_id
                FROM icq_messages
                WHERE sender_id=%s OR receiver_id=%s
            ) last_msg
            JOIN icq_users u ON u.id = last_msg.other_id
            ORDER BY other_id, last_msg.sent_at DESC
        """, (my_id, my_id, my_id, my_id))
        rows = cur.fetchall()
        
        # Sort by last message time
        cur.execute("""
            SELECT 
                CASE WHEN sender_id=%s THEN receiver_id ELSE sender_id END as other_id,
                u.uin, u.nickname, u.first_name, u.last_name, u.status, u.avatar_url,
                m.content, m.sent_at, m.sender_id,
                (SELECT COUNT(*) FROM icq_messages WHERE receiver_id=%s AND sender_id=CASE WHEN m.sender_id=%s THEN m.receiver_id ELSE m.sender_id END AND is_read=FALSE) as unread
            FROM icq_messages m
            JOIN icq_users u ON u.id = CASE WHEN m.sender_id=%s THEN m.receiver_id ELSE m.sender_id END
            WHERE (m.sender_id=%s OR m.receiver_id=%s)
            AND m.id IN (
                SELECT MAX(id) FROM icq_messages
                WHERE sender_id=%s OR receiver_id=%s
                GROUP BY CASE WHEN sender_id=%s THEN receiver_id ELSE sender_id END
            )
            ORDER BY m.sent_at DESC
        """, (my_id, my_id, my_id, my_id, my_id, my_id, my_id, my_id, my_id))
        rows = cur.fetchall()
        
        dialogs = []
        seen = set()
        for r in rows:
            other_id = r[0]
            if other_id in seen:
                continue
            seen.add(other_id)
            dialogs.append({
                'user': {
                    'id': other_id, 'uin': r[1], 'nickname': r[2],
                    'first_name': r[3], 'last_name': r[4], 'status': r[5], 'avatar_url': r[6]
                },
                'last_message': r[7],
                'last_time': r[8].isoformat() if r[8] else None,
                'is_mine': r[9] == my_id,
                'unread': int(r[10])
            })
        
        cur.close()
        db.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'dialogs': dialogs})}

    # GET /history?with=user_id&limit=50&before=id
    if method == 'GET' and '/history' in path:
        params = event.get('queryStringParameters') or {}
        with_id = params.get('with')
        limit = min(int(params.get('limit', 50)), 100)
        before = params.get('before')
        
        if not with_id:
            cur.close()
            db.close()
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Укажите with'})}
        
        # Mark as read
        cur.execute(
            "UPDATE icq_messages SET is_read=TRUE WHERE sender_id=%s AND receiver_id=%s AND is_read=FALSE",
            (int(with_id), my_id)
        )
        
        query = """
            SELECT m.id, m.sender_id, m.receiver_id, m.content, m.is_read, m.sent_at,
                   u.uin, u.nickname
            FROM icq_messages m
            JOIN icq_users u ON u.id = m.sender_id
            WHERE (m.sender_id=%s AND m.receiver_id=%s) OR (m.sender_id=%s AND m.receiver_id=%s)
        """
        args = [my_id, int(with_id), int(with_id), my_id]
        
        if before:
            query += " AND m.id < %s"
            args.append(int(before))
        
        query += " ORDER BY m.sent_at DESC LIMIT %s"
        args.append(limit)
        
        cur.execute(query, args)
        rows = cur.fetchall()
        db.commit()
        cur.close()
        db.close()
        
        messages = []
        for r in reversed(rows):
            messages.append({
                'id': r[0], 'sender_id': r[1], 'receiver_id': r[2],
                'content': r[3], 'is_read': r[4],
                'sent_at': r[5].isoformat(),
                'sender_uin': r[6], 'sender_nickname': r[7],
                'is_mine': r[1] == my_id
            })
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'messages': messages})}

    # POST /send — отправить сообщение
    if method == 'POST' and '/send' in path:
        body = json.loads(event.get('body') or '{}')
        to_id = body.get('to_id')
        content = body.get('content', '').strip()
        
        if not to_id or not content:
            cur.close()
            db.close()
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Укажите получателя и текст'})}
        
        cur.execute("SELECT id FROM icq_users WHERE id=%s", (int(to_id),))
        if not cur.fetchone():
            cur.close()
            db.close()
            return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Получатель не найден'})}
        
        cur.execute(
            "INSERT INTO icq_messages (sender_id, receiver_id, content) VALUES (%s, %s, %s) RETURNING id, sent_at",
            (my_id, int(to_id), content)
        )
        msg = cur.fetchone()
        db.commit()
        cur.close()
        db.close()
        
        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'success': True,
                'message': {
                    'id': msg[0], 'sender_id': my_id, 'receiver_id': int(to_id),
                    'content': content, 'sent_at': msg[1].isoformat(), 'is_mine': True
                }
            })
        }

    # GET /unread-count
    if method == 'GET' and '/unread-count' in path:
        cur.execute("SELECT COUNT(*) FROM icq_messages WHERE receiver_id=%s AND is_read=FALSE", (my_id,))
        count = cur.fetchone()[0]
        cur.close()
        db.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'count': count})}

    cur.close()
    db.close()
    return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Not found'})}
