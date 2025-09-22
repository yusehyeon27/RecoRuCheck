require("dotenv").config();
const fs = require("fs");
const path = require("path");
const prompt = require("prompt-sync")();
const { chromium } = require("playwright");
const nodemailer = require("nodemailer");

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

const now = new Date();
const timestamp =
  now.getFullYear() +
  String(now.getMonth() + 1).padStart(2, "0") +
  String(now.getDate()).padStart(2, "0") +
  String(now.getHours()).padStart(2, "0") +
  String(now.getMinutes()).padStart(2, "0");

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
  const currentUrl = page.url();
  if (currentUrl.includes("/ap/home")) {
    console.log("⚠ すでにログイン済みです。 ログアウト後、再ログインします。");
    try {
      await page.click(".text-overflow-hidden");
      await page.waitForSelector(".icon-exit-to-app", { timeout: 5000 });
      await page.click(".icon-exit-to-app");
      await page.waitForSelector("#authId", { timeout: 10000 });
      console.log("✅ログアウト 完了");
    } catch (err) {
      console.error("❌ログアウト 失敗: " + err.message);
      await context.close();
      process.exit(1);
    }
  }
  await page.waitForSelector("#authId", { timeout: 5000 });
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
// 社員チェック (modeで挙動切替)
// ----------------------
async function processStaffPages(page, yearInput, monthInput, day = 1) {
  const mm = String(monthInput).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const trClass = `${yearInput}${mm}${dd}`;

  let hasNextPage = true;
  let logContent = `=== ${yearInput}年${monthInput}月 社員チェック結果 (mode=${config.mode}) ===\n\n`;

  const ERROR_LOG_DIR = path.isAbsolute(config.error.ERROR_LOG_DIR)
    ? config.error.ERROR_LOG_DIR
    : path.join(process.cwd(), config.error.ERROR_LOG_DIR);

  if (!fs.existsSync(ERROR_LOG_DIR)) {
    fs.mkdirSync(ERROR_LOG_DIR, { recursive: true });
  }

  while (hasNextPage) {
    await page.waitForSelector(`tr[class*="${trClass}"]`, { timeout: 10000 });
    const staffList = await page.$$eval(
      `tr[class*="${trClass}"] td.item-userNameAndId a.link`,
      (els) => els.map((el) => ({ href: el.href, name: el.textContent.trim() }))
    );

    console.log(`${staffList.length}人の社員リスト取得完了`);

    for (const staff of staffList) {
      let hasError = false;
      const staffPage = await page.context().newPage();
      await staffPage.goto(staff.href, { waitUntil: "networkidle" });

      console.log(`✅ 処理中: ${staff.name} (${staff.href})`);
      try {
        // チェックボタン
        await staffPage.waitForSelector("#checker", { timeout: 5000 });
        await staffPage.click("#checker");

        // ポップアップ待機
        await staffPage.waitForSelector(
          ".ui-dialog-content.ui-widget-content",
          {
            timeout: 5000,
          }
        );

        // ポップアップ結果
        const popupTexts = await staffPage.$$eval(
          "div.ui-dialog-content",
          (els) => els.map((el) => el.innerText.trim())
        );

        for (const text of popupTexts) {
          console.log(`👉 ${staff.name} チェック結果: ${text}`);
          if (
            text !== "エラーはありません" &&
            text !== "エラーはありません。"
          ) {
            hasError = true;
            logContent += `❌ ${staff.name}\nエラー: \n${text}\n\n`;
          }
        }

        // ダイアログ閉じる
        await staffPage.keyboard.press("Escape").catch(() => {});

        // エラーなし → modeに応じて処理分岐
        if (!hasError) {
          try {
            await staffPage.waitForSelector(
              'label[for="CHECKBOX-approved_2"]',
              { timeout: 5000 }
            );
            await staffPage.click('label[for="CHECKBOX-approved_2"]');
            logContent += `✅ ${staff.name} 承認チェック完了\n`;

            if (config.mode === 1) {
              // === 本番実行モード ===
              staffPage.once("dialog", async (dialog) => {
                console.log(`⚠ 確認ダイアログ表示: ${dialog.message()}`);
                await dialog.accept();
              });

              await Promise.all([
                staffPage.waitForResponse(
                  (res) => res.url().includes("update") && res.status() === 200
                ),
                staffPage.click("#UPDATE-BTN"),
              ]);

              await staffPage
                .waitForSelector("div.ui-dialog-content", { timeout: 5000 })
                .catch(() =>
                  console.log("⚠ 更新確認ダイアログが表示されませんでした")
                );

              console.log(`✅ ${staff.name} 更新ボタン押下完了`);
              logContent += `✅ ${staff.name} 更新完了\n\n`;
            } else if (config.mode === 2) {
              // === 確認のみモード ===
              await staffPage.waitForSelector("#UPDATE-BTN", { timeout: 5000 });
              console.log(`🛈 ${staff.name} 更新ボタン確認済み（クリックなし）`);
              logContent += `🛈 ${staff.name} 更新ボタン確認済み（クリックなし）\n\n`;
            }
          } catch (err) {
            console.error(
              `❌ ${staff.name} 承認チェック/更新処理失敗: ${err.message}`
            );
            logContent += `❌ ${staff.name} 承認チェック/更新処理失敗: ${err.message}\n`;
          }
        }
      } catch (err) {
        console.error(`❌ ${staff.name} チェック失敗: ${err.message}`);
        logContent += `❌ ${staff.name} チェック失敗: ${err.message}\n`;
      }

      await staffPage.close();
    }

    const nextButton = await page.$('div.pager li[onclick="nextPage();"]');
    if (nextButton) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle" }),
        nextButton.click(),
      ]);
      await page.waitForTimeout(500);
    } else {
      hasNextPage = false;
    }
  }

  return logContent;
}

// ----------------------
// メール送付
// ----------------------
async function sendMail(attachments, mappedName, yearInput, monthInput) {
  const transporter = nodemailer.createTransport({
    host: "smtp.worksmobile.com",
    port: 587,
    secure: false,
    auth: {
      user: config.from.LINE_USER,
      pass: config.from.LINE_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  const mailOptions = {
    from: config.from.LINE_USER,
    to: config.mail.MAIL_TO,
    subject: `${mappedName} ${yearInput}年 ${monthInput}月のRecoRuチェック結果`,
    text: `${mappedName} ${yearInput}年${monthInput}月-社員チェック結果`,
    attachments: attachments,
  };

  await transporter.sendMail(mailOptions);
  console.log("📧 メール送信完了");
}

// ----------------------
// メイン
// ----------------------
async function main() {
  // modeチェック
  if (config.mode !== 1 && config.mode !== 2) {
    console.error(`❌ config.json の "mode" が不正です: ${config.mode}`);
    console.error(`1 = 実際に処理, 2 = ログのみ`);
    process.exit(1);
  }
  console.log(`🛈 実行モード: ${config.mode === 1 ? "本番実行" : "確認のみ"}`);

  console.log("部署を選択してください：");
  //console.log("1: 経営総括部");
  console.log("1: 大阪本社");
  console.log("2: 本社営業部");
  console.log("3: 事業総括部");
  console.log("4: システム開発1部");
  console.log("5: システム開発2部");
  console.log("6: システム開発3部");
  console.log("7: エンベデッド部");
  console.log("8: 人事DX部");
  console.log("9: ビジネスサポート部");

  const choice = prompt("番号入力: ");
  const yearInput = parseInt(prompt("年入力 (例:2025):"), 10);
  const monthInput = parseInt(prompt("月入力 (1~12):"), 10);

  const map = {
    1: "大阪本社",
    2: "本社営業部",
    3: "事業総括部",
    4: "システム開発1部",
    5: "システム開発2部",
    6: "システム開発3部",
    7: "エンベデッド部",
    8: "人事DX部",
    9: "ビジネスサポート部",
  };
  const mappedName = map[choice];

  const profile = config.profile.USER_PROFILE_PATH;
  const expath = config.extensions.EXTENSION_PATH;
  // const temp = config.temp.TEMP_PROFILE_PATH;

  // if (!fs.existsSync(temp)) {
  //   fs.mkdirSync(temp, { recursive: true });
  // }

  console.log("User Chrome Path:", profile);
  console.log("Extension Path:", expath);

  // Playwright Persistent Context
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    executablePath: config.edge.EDGE_PATH,
    args: [
      `--load-extension=${expath}`,
      "--start-maximized",
      `--disable-extensions-except=${expath}`,
    ],
    viewport: null,
  });

  const page = await context.newPage();

  // ログイン
  await login(page, context);

  const listSelector = "#SIDE-MENU li";
  let okA = await selectBushoByIndex(page, listSelector, choice);
  if (!okA && mappedName) {
    await selectBushoByName(page, listSelector, mappedName);
  }

  await selectYearMonth(page, yearInput, monthInput);

  console.log(
    `部署、年月選択完了：${mappedName}, ${yearInput}年 ${monthInput}月`
  );
  const logContent = await processStaffPages(page, yearInput, monthInput);

  const logFileName = `${mappedName} ${yearInput}年${monthInput}月-社員チェック結果${timestamp}.log`;
  const logPath = path.join(
    path.isAbsolute(config.error.ERROR_LOG_DIR)
      ? config.error.ERROR_LOG_DIR
      : path.join(process.cwd(), config.error.ERROR_LOG_DIR),
    logFileName
  );
  fs.writeFileSync(logPath, logContent, "utf8");
  console.log("📄 ログ保存完了: " + logPath);

  const attachments = [{ filename: logFileName, path: logPath }];
  await sendMail(attachments, mappedName, yearInput, monthInput);

  await context.close();
}

main().catch((err) => {
  console.error("❌ メイン処理中にエラー発生:", err);
  process.exit(1);
});
