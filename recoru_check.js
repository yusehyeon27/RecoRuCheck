require("dotenv").config();
const fs = require("fs");
const path = require("path");
const prompt = require("prompt-sync")();
const { chromium } = require("playwright");

// ----------------------
// config.json読み込み
// ----------------------
const configPath = path.join(process.cwd(), "config.json");
if (!fs.existsSync(configPath)) {
  console.error(
    "⚠ config.json が見つかりません。EXEと同じフォルダに配置してください。"
  );
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// ----------------------
// 部署選択 (番号)
// ----------------------
async function selectBushoByIndex(page, listSelector, choice) {
  await page.waitForSelector(listSelector, { timeout: 5000 });

  const items = await page.$$eval(listSelector, (els) =>
    els.map((e) => {
      const span = e.querySelector("span");
      return {
        id: e.getAttribute("id") || "",
        text: (span ? span.innerText : e.innerText).trim(),
      };
    })
  );

  const index = parseInt(choice, 10) - 1;
  if (isNaN(index) || index < 0 || index >= items.length) {
    console.error("番号が正しくありません");
    return false;
  }

  const targetId = items[index].id;
  const sel = `#SIDE-MENU li[id="${targetId}"] a`;
  const handle = await page.$(sel);
  if (handle) {
    await page.waitForTimeout(500);
    await handle.click();
    console.log(`✅ ${items[index].text} 選択完了`);
    return true;
  } else {
    console.error("handle.clickが見つかりません");
    return false;
  }
}

// ----------------------
// 部署選択 (名前)
// ----------------------
async function selectBushoByName(page, listSelector, name) {
  await page.waitForSelector(listSelector, { timeout: 5000 });

  const clicked = await page.$$eval(
    listSelector,
    (els, targetName) => {
      const item = els.find((e) => {
        const span = e.querySelector("span");
        return span && span.innerText.trim() === targetName;
      });
      if (!item) return false;
      const a = item.querySelector("a");
      if (!a) return false;
      a.click();
      return true;
    },
    name
  );

  if (clicked) console.log(`✅ "${name}" 選択完了`);
  else console.error(`❌ "${name}" 選択失敗`);
  return clicked;
}

// ----------------------
// 年月選択
// ----------------------
async function selectYearMonth(page, targetYear, targetMonth) {
  await page.waitForSelector(".acm-displayDate", { timeout: 10000 });
  await page.click(".acm-displayDate");

  while (true) {
    const [currentYear, currentMonth] = await page.evaluate(() => {
      const year = parseInt(
        document.querySelector(".ui-datepicker-year").innerText,
        10
      );
      const monthText = document.querySelector(
        ".ui-datepicker-month"
      ).innerText;
      const month = parseInt(monthText.replace("月", ""), 10);
      return [year, month];
    });

    if (currentYear === targetYear && currentMonth === targetMonth) break;

    if (
      currentYear > targetYear ||
      (currentYear === targetYear && currentMonth > targetMonth)
    ) {
      await page.click(".ui-datepicker-prev");
    } else {
      await page.click(".ui-datepicker-next");
    }
    await page.waitForTimeout(200);
  }

  await page.$$eval(".ui-datepicker-calendar td a", (els) => {
    const firstDay = els.find((e) => e.innerText === "1");
    if (firstDay) firstDay.click();
  });

  console.log(`✅ ${targetYear}年 ${targetMonth}月 1日 選択完了`);
}

// ----------------------
// ログイン
// ----------------------
async function login(page, context) {
  page.on("dialog", async (dialog) => {
    console.error("❌ ログイン失敗: " + dialog.message());
    await dialog.dismiss();
    await context.close();
    process.exit(1);
  });

  await page.goto("https://app.recoru.in/ap/", { waitUntil: "networkidle" });
  await page.waitForSelector("#authId", { timeout: 5000 });

  const isLoggedIn = (await page.$("#authId")) === null;
  if (isLoggedIn) {
    console.log("⚠ 이미 로그인된 상태입니다. 로그아웃 후 재로그인 합니다.");
    await page.click(".text-overflow-hidden");
    await page.waitForSelector(".icon-exit-to-app", { timeout: 5000 });
    await page.click(".icon-exit-to-app"); // 실제 로그아웃 버튼 selector
    await page.waitForSelector("#authId", { timeout: 5000 });
  }

  await page.fill("#contractId", config.recoru.RECORU_CONTRACTID);
  await page.fill("#authId", config.recoru.RECORU_USER);
  await page.fill("#password", config.recoru.RECORU_PASS);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    page.click('input[type="button"]'),
  ]);

  try {
    await page.waitForSelector("#m2", { timeout: 5000 });
    await page.click("#m2");
    console.log("✅ ログイン成功");
  } catch (err) {
    console.error(
      "❌ ログインに失敗しました。ID/パスワードを確認してください。"
    );
    await context.close();
    process.exit(1);
  }
}

// ----------------------
// 社員チェック
// ----------------------
async function processStaffPages(page, yearInput, monthInput, day = 1) {
  const mm = String(monthInput).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const trClass = `${yearInput}${mm}${dd}`;

  let hasNextPage = true;

  while (hasNextPage) {
    await page.waitForSelector(`tr[class*="${trClass}"]`, { timeout: 10000 });
    const staffList = await page.$$eval(
      `tr[class*="${trClass}"] td.item-userNameAndId a.link`,
      (els) => els.map((el) => ({ href: el.href, name: el.textContent.trim() }))
    );

    console.log(`${staffList.length}人の社員リスト取得完了`);

    for (const staff of staffList) {
      const staffPage = await page.context().newPage();
      await staffPage.goto(staff.href, { waitUntil: "networkidle" });

      console.log(`✅ 処理中: ${staff.name} (${staff.href})`);
      await staffPage.waitForTimeout(300);
      await staffPage.close();
    }

    const nextButton = await page.$('div.pager li[onclick="nextPage();"]');
    if (nextButton) {
      console.log("➡ 次のページに移動");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle" }),
        nextButton.click(),
      ]);
      await page.waitForTimeout(500);
    } else hasNextPage = false;
  }
  console.log("全社員処理完了");
}

// ----------------------
// メイン
// ----------------------
async function main() {
  console.log("部署を選択してください：");
  console.log("1: 経営総括部");
  console.log("2: 大阪本社");
  console.log("3: 本社営業部");
  console.log("4: 事業総括部");
  console.log("5: システム開発1部");
  console.log("6: システム開発2部");
  console.log("7: システム開発3部");
  console.log("8: エンベデッド部");
  console.log("9: 人事DX部");
  console.log("10: ビジネスサポート部");

  const choice = prompt("番号入力: ");
  const yearInput = parseInt(prompt("年入力 (例：2025)："), 10);
  const monthInput = parseInt(prompt("月入力 (1~12):："), 10);

  const map = {
    1: "経営総括部",
    2: "大阪本社",
    3: "本社営業部",
    4: "事業総括部",
    5: "システム開発1部",
    6: "システム開発2部",
    7: "システム開発3部",
    8: "エンベデッド部",
    9: "人事DX部",
    10: "ビジネスサポート部",
  };
  const mappedName = map[choice];

  const profile = config.profile.USER_CHROME_PATH;
  const expath = config.extensions.EXTENSION_PATH;
  const temp = config.temp.TEMP_PROFILE_PATH;

  if (!fs.existsSync(temp)) {
    fs.mkdirSync(temp, { recursive: true });
  }

  console.log("User Chrome Path:", profile);
  console.log("Extension Path:", expath);

  // Playwright에서 Persistent Context 사용
  const context = await chromium.launchPersistentContext(
    profile, // 기존 프로필
    {
      headless: false,
      executablePath: config.edge.EDGE_PATH,
      args: [
        "--load-extension=${expath}",
        "--start-maximized",
        "--disable-extensions-except=" + expath,
      ], // 확장은 따로 args로 추가
      viewport: null,
    }
  );

  const page = await context.newPage();

  // 로그인 실행
  await login(page, context);

  const listSelector = "#SIDE-MENU li";

  let okA = await selectBushoByIndex(page, listSelector, choice);
  if (!okA && mappedName) {
    await selectBushoByName(page, listSelector, mappedName);
  }

  //await page.pause();

  await selectYearMonth(page, yearInput, monthInput);

  console.log(
    `部署、年月選択完了：${mappedName}, ${yearInput}年 ${monthInput}月`
  );

  await processStaffPages(page, yearInput, monthInput);

  // context.close() // 종료할 때
}

main();
