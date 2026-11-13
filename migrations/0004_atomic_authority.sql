CREATE TABLE mutation_guards (
 id TEXT PRIMARY KEY,
 allowed INTEGER NOT NULL CHECK (allowed = 1)
);

DROP TRIGGER retain_last_operator;
CREATE TRIGGER retain_last_operator BEFORE DELETE ON auth_operators
WHEN EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id AND status='active')
 AND NOT EXISTS (SELECT 1 FROM auth_operators o JOIN users u ON u.id=o.user_id
                 WHERE o.user_id<>OLD.user_id AND u.status='active')
BEGIN
 SELECT RAISE(ABORT,'LAST_OPERATOR');
END;

CREATE TRIGGER retain_active_operator BEFORE UPDATE OF status ON users
WHEN OLD.status='active' AND NEW.status<>'active'
 AND EXISTS (SELECT 1 FROM auth_operators WHERE user_id=OLD.id)
 AND NOT EXISTS (SELECT 1 FROM auth_operators o JOIN users u ON u.id=o.user_id
                 WHERE o.user_id<>OLD.id AND u.status='active')
BEGIN
 SELECT RAISE(ABORT,'LAST_OPERATOR');
END;
