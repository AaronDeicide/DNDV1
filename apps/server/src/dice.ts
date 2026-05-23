import { nanoid } from "nanoid";

export type DiceRollResult = {
  expression: string;
  rolls: number[];
  modifier: number;
  total: number;
  detail: string;
  id: string;
};

/**
 * 极简骰子表达式解析：
 * - 支持：`d20`、`2d6`、`2d6+3`、`d20-1`
 * - 不支持：adv/dis、括号、多个项相加等（后续可扩展）
 */
export function rollDice(expressionRaw: string): DiceRollResult {
  const expression = expressionRaw.replace(/\s+/g, "");
  const m = expression.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) throw new Error("不支持的表达式（示例：d20、2d6+3）");

  const count = Math.max(1, Number(m[1] || 1));
  const sides = Number(m[2]);
  const modifier = Number(m[3] || 0);
  if (!Number.isFinite(sides) || sides <= 1 || sides > 100000) throw new Error("骰子面数不合法");
  if (!Number.isFinite(count) || count < 1 || count > 200) throw new Error("骰子数量不合法");
  if (!Number.isFinite(modifier) || Math.abs(modifier) > 100000) throw new Error("修正值不合法");

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(1 + Math.floor(Math.random() * sides));
  }
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + modifier;

  const modStr = modifier === 0 ? "" : modifier > 0 ? `+${modifier}` : `${modifier}`;
  const detail = `${count}d${sides}${modStr} = [${rolls.join(", ")}]${modStr ? " " + modStr : ""} => ${total}`;

  return { expression, rolls, modifier, total, detail, id: nanoid(12) };
}

