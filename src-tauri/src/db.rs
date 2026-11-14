//! Local SQLite access for the desktop app.
//!
//! One connection behind a mutex, so a batch really is one transaction.
//! (A connection pool can run BEGIN and COMMIT on different connections,
//! which locks the database.) The file lives in the per user app data
//! directory and never leaves the machine.

use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use serde::Deserialize;
use serde_json::{Map, Number, Value};
use std::{path::Path, sync::Mutex};

pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
        Ok(Db(Mutex::new(conn)))
    }

    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(Db(Mutex::new(conn)))
    }
}

#[derive(Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

fn to_sql(v: &Value) -> Result<SqlValue, String> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().ok_or("invalid number")?)
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        _ => return Err("only null, boolean, number and string parameters are supported".into()),
    })
}

fn from_sql(v: rusqlite::types::ValueRef) -> Value {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Value::Null,
        Integer(i) => Value::Number(i.into()),
        Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        Blob(_) => Value::Null,
    }
}

fn params(p: &[Value]) -> Result<Vec<SqlValue>, String> {
    p.iter().map(to_sql).collect()
}

/// Run statements atomically. A statement without parameters may contain
/// several SQL statements (used for migrations).
pub fn batch(conn: &mut Connection, statements: &[Statement]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for s in statements {
        if s.params.is_empty() {
            tx.execute_batch(&s.sql).map_err(|e| e.to_string())?;
        } else {
            tx.execute(&s.sql, params_from_iter(params(&s.params)?)).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

pub fn select(conn: &Connection, sql: &str, p: &[Value]) -> Result<Vec<Map<String, Value>>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(params(p)?)).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut m = Map::new();
        for (i, n) in names.iter().enumerate() {
            m.insert(n.clone(), from_sql(row.get_ref(i).map_err(|e| e.to_string())?));
        }
        out.push(m);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_batch(state: tauri::State<'_, Db>, statements: Vec<Statement>) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    batch(&mut conn, &statements)
}

#[tauri::command]
pub fn db_select(state: tauri::State<'_, Db>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    select(&conn, &sql, &params)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn st(sql: &str, params: Vec<Value>) -> Statement {
        Statement { sql: sql.into(), params }
    }

    #[test]
    fn batch_is_atomic() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.0.lock().unwrap();
        batch(&mut c, &[st("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL); PRAGMA user_version = 1;", vec![])]).unwrap();
        let err = batch(&mut c, &[
            st("INSERT INTO t (v) VALUES (?)", vec![json!("a")]),
            st("INSERT INTO t (v) VALUES (?)", vec![Value::Null]),
        ]);
        assert!(err.is_err());
        assert_eq!(select(&c, "SELECT COUNT(*) AS n FROM t", &[]).unwrap()[0]["n"], json!(0));
        assert_eq!(select(&c, "PRAGMA user_version", &[]).unwrap()[0]["user_version"], json!(1));
    }

    #[test]
    fn select_returns_typed_columns() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.0.lock().unwrap();
        batch(&mut c, &[
            st("CREATE TABLE t (a INTEGER, b REAL, c TEXT, d TEXT)", vec![]),
            st("INSERT INTO t VALUES (?, ?, ?, ?)", vec![json!(3), json!(1.5), json!("x"), Value::Null]),
        ]).unwrap();
        let rows = select(&c, "SELECT * FROM t WHERE a = ?", &[json!(3)]).unwrap();
        assert_eq!(rows[0]["a"], json!(3));
        assert_eq!(rows[0]["b"], json!(1.5));
        assert_eq!(rows[0]["c"], json!("x"));
        assert_eq!(rows[0]["d"], Value::Null);
    }

    #[test]
    fn rejects_unsupported_parameter_types() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.0.lock().unwrap();
        batch(&mut c, &[st("CREATE TABLE t (a TEXT)", vec![])]).unwrap();
        assert!(batch(&mut c, &[st("INSERT INTO t VALUES (?)", vec![json!({"x": 1})])]).is_err());
    }
}
