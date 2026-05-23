import { prisma } from "../db";

// 用法：
// 1) 先确保 DATABASE_URL 已配置（apps/server/.env）
// 2) 执行：npm run admin:promote --workspace @dnd/server -- --email you@example.com
//    或：npm run admin:promote --workspace @dnd/server -- --id <userId>

function readArg(name: string) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return "";
  return String(process.argv[idx + 1] ?? "");
}

async function main() {
  const email = readArg("--email").trim().toLowerCase();
  const id = readArg("--id").trim();

  if (!email && !id) {
    console.error("请提供 --email 或 --id");
    process.exit(1);
  }

  const user = email ? await prisma.user.findUnique({ where: { email } }) : await prisma.user.findUnique({ where: { id } });
  if (!user) {
    console.error("未找到用户");
    process.exit(1);
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  console.log(`已将用户设为 ADMIN：${user.id} ${user.name} ${user.email ?? ""}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

