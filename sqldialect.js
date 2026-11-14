// SQL 方言兼容工具
// - SQLite: ? 占位符, AUTOINCREMENT, strftime
// - Postgres: $1 占位符, SERIAL/sequences, 不同函数
const { PG_MODE } = require('./db');

function toPgSql(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => '$' + (++idx));
}

function ph(sql) {
  return PG_MODE ? toPgSql(sql) : sql;
}

// 时间函数:SQLite strftime('%Y','now') → pg to_char(now(),'YYYY')
function translate(sql) {
  if (!PG_MODE) return sql;
  let s = sql;
  // printf('%012d', uid) → lpad(uid::text, 12, '0')
  s = s.replace(/printf\('%012d',/g, `lpad(`);
  // 需要把 lpad( 后第一个列名转 text —— 简化:pg 的 lpad 也接受 text,数字需::text
  // 用正则补 ::text: lpad(x, 12, '0') 中 x 若非字符串会报错,统一处理
  s = s.replace(/lpad\((\w+),\s*12/g, `lpad($1::text, 12`);
  s = s.replace(/lpad\(uid, 12/g, `lpad(uid::text, 12`);
  s = s.replace(/lpad\(u\.uid, 12/g, `lpad(u.uid::text, 12`);
  // instr → position
  s = s.replace(/instr\(/g, 'position(');
  // AUTOINCREMENT 相关在建表时单独处理
  return s;
}

// 完整的 prepare 包装:占位符 + 方言翻译
function P(sql) {
  return translate(ph(sql));
}

module.exports = { P, PG_MODE, toPgSql, translate };
