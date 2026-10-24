// =============================================================
// 常設のオープンチャット部屋で、ボット同士が雑談する台本と、それを流す仕組み
// -------------------------------------------------------------
// - AIは使いません。ここに書いた台本を、決まった順番(話題はシャッフル)で、間を空けながら流します。
// - ボットの名前には必ず [BOT] を付けます(人と間違えないようにするため)。
// - 話題・セリフを増やしたいときは、BOT_ROOMS の threads に、[話す人の番号, セリフ] の並びを足すだけです。
//   「話す人の番号」は、その部屋の bots の何番目か(0始まり)です。
// - 部屋のコード(OPUB01〜)は、server.js の PERMANENT_OPEN_ROOMS と同じにしてください。
// - 止めたいとき: 環境変数 BOT_CHAT=off でサーバーを起動します。
//
// 【人の話し相手になる機能】
// - 人が発言すると、ボットが返事をします(入室したときは、あいさつもします)。返事は、まずこのファイルの
//   ルール(キーワードで選ぶ定型文)で作ります。AIは使いません。
// - AIのキーを環境変数に設定すると、ふつうの会話だけAIが返事を作ります。失敗したときは、ルールの返事に戻ります。
//     GROQ_API_KEY      … Groq(省略時のモデル llama-3.1-8b-instant)
//     XAI_API_KEY       … xAI の Grok(省略時のモデル grok-4.3)
//     ANTHROPIC_API_KEY … Claude(省略時のモデル claude-haiku-5-5)
//   複数あるときは、上の順に使います。BOT_AI_PROVIDER=groq|xai|anthropic で、使う会社を指定もできます。
//   モデルは BOT_AI_MODEL で変更、1時間の上限は BOT_AI_MAX_PER_HOUR(省略時 120)。
// - 「死にたい」などの言葉には、AIでもルールでもなく、必ず決まった返事(相談窓口の案内つき)を返します。
// - 人が話している間は、ボット同士の雑談はいったん止まります。
// =============================================================

const BOT_ROOMS = {
  // 雑談ひろば
  OPUB01: {
    bots: [
      { id: "mina", name: "ミナ[BOT]", color: "#f472b6" },
      { id: "haru", name: "ハル[BOT]", color: "#60a5fa" },
      { id: "sora", name: "ソラ[BOT]", color: "#34d399" },
    ],
    threads: [
      [
        [0, "おはよー、今日なに食べる？"],
        [1, "朝はパンかな〜。ミナは？"],
        [0, "ごはんと味噌汁派！朝はやっぱりこれ"],
        [2, "わかる、あったかいの落ち着くよね"],
        [1, "夜は何食べたくなる？私はラーメン一択"],
        [2, "ラーメンいいね…今から食べたくなってきた"],
        [0, "こらこら、夜まで我慢だよ(笑)"],
      ],
      [
        [1, "今週末なにする予定？"],
        [2, "天気よかったら散歩かな。ゆるっと"],
        [0, "私は家で映画かな。積んでるやつ消化したい"],
        [1, "積み映画、あるある。増える一方"],
        [2, "配信で観ると、観たいリストだけ育っていくよね"],
        [0, "それ！リストは100超えてる(笑)"],
      ],
      [
        [2, "最近ちゃんと寝れてる？"],
        [0, "夜更かししがち…つい動画見ちゃう"],
        [1, "わかる。あと5分のつもりが1時間"],
        [2, "寝る前はスマホ置くといいらしいよ。自分もできてないけど"],
        [0, "言うは易しだよねぇ(笑)"],
        [1, "今日こそ早く寝よう、せーので！"],
      ],
    ],
  },

  // ゲームの部屋
  OPUB02: {
    bots: [
      { id: "ken", name: "ケン[BOT]", color: "#f97316" },
      { id: "riku", name: "リク[BOT]", color: "#a78bfa" },
      { id: "nana", name: "ナナ[BOT]", color: "#22d3ee" },
    ],
    threads: [
      [
        [0, "積みゲーって何本くらいある？"],
        [1, "数えたくないけど、たぶん10本以上…"],
        [2, "私は買っただけで満足するタイプ(笑)"],
        [0, "セールで買っちゃうんだよなぁ"],
        [1, "結局やるのは同じゲームの周回だったりする"],
        [2, "それが一番楽しいのでは？"],
        [0, "確かに。慣れたゲームは安心感あるよね"],
      ],
      [
        [2, "協力プレイと対戦、どっち派？"],
        [0, "協力かなー。勝っても負けても平和"],
        [1, "対戦は燃えるけど、負けるとちょっとへこむ"],
        [2, "わかる。でも勝てた時の気持ちよさは別格"],
        [1, "結局どっちも好きってことだね"],
        [0, "それな！"],
      ],
      [
        [1, "最近、昔のゲームをまたやりたくなる"],
        [0, "リメイクとか出ると嬉しいよね"],
        [2, "音楽が流れた瞬間に思い出がよみがえるやつ"],
        [1, "あれはずるい。一発で泣ける"],
        [0, "BGMの力ってすごいよね"],
      ],
    ],
  },

  // 音楽ラウンジ
  OPUB03: {
    bots: [
      { id: "ren", name: "レン[BOT]", color: "#fb7185" },
      { id: "yui", name: "ユイ[BOT]", color: "#fbbf24" },
      { id: "taku", name: "タク[BOT]", color: "#2dd4bf" },
    ],
    threads: [
      [
        [0, "作業中って音楽かける派？無音派？"],
        [1, "歌詞のないやつなら流すかなー"],
        [2, "僕は集中したい時ほど無音"],
        [0, "なるほど、人によって違うんだね"],
        [1, "歌詞があると、つい一緒に歌っちゃって進まない(笑)"],
        [2, "それは仕方ない"],
      ],
      [
        [2, "ライブ行ったことある？"],
        [1, "あるよ！音の迫力が全然違う"],
        [0, "いいなぁ。行ってみたいけど、人混みが苦手で"],
        [1, "小さい会場から始めるのがおすすめ"],
        [2, "距離が近いと、演奏してるところがよく見えて楽しいよ"],
        [0, "今度、探してみようかな"],
      ],
      [
        [1, "通勤中は何聴いてる？"],
        [0, "プレイリストをシャッフルしてるよ"],
        [2, "僕は朝はゆっくりめ、帰りは元気なやつ"],
        [1, "いいね、行きと帰りで気分を変えるの"],
        [0, "それ真似しよう"],
      ],
    ],
  },

  // 勉強ルーム
  OPUB04: {
    bots: [
      { id: "aya", name: "アヤ[BOT]", color: "#818cf8" },
      { id: "sho", name: "ショウ[BOT]", color: "#4ade80" },
      { id: "mai", name: "マイ[BOT]", color: "#f9a8d4" },
    ],
    threads: [
      [
        [0, "今日は何を勉強する予定？"],
        [1, "英語の単語を少しずつ進める予定！"],
        [2, "私は資格の問題集。まずは1章だけ"],
        [0, "1章だけ、って決めると始めやすいよね"],
        [1, "始めるまでが一番しんどい"],
        [2, "5分だけやる、から始めると続くよ"],
      ],
      [
        [2, "25分集中して5分休む、ってやり方試したことある？"],
        [0, "あるよ。区切りがあると、意外と集中できる"],
        [1, "タイマー鳴ると、もうちょっとやりたくなる(笑)"],
        [2, "その気持ちのまま休むのがコツらしいよ"],
        [0, "休憩中はスマホ見ないで、軽く伸びするのがおすすめ"],
      ],
      [
        [1, "暗記って、どうやってる？"],
        [2, "声に出して、書いて、また声に出す感じ"],
        [0, "寝る前に1回見直して、朝にもう1回やる"],
        [1, "朝にもう1回、いいね。試してみる"],
        [2, "無理せず、少しずつ積み重ねよう"],
      ],
    ],
  },

  // なんでも部屋
  OPUB05: {
    bots: [
      { id: "momo", name: "モモ[BOT]", color: "#fcd34d" },
      { id: "kai", name: "カイ[BOT]", color: "#38bdf8" },
      { id: "rin", name: "リン[BOT]", color: "#c084fc" },
    ],
    threads: [
      [
        [0, "最近ハマってることある？"],
        [1, "最近は料理かな。簡単なやつだけど"],
        [2, "いいね！何作ったの？"],
        [1, "野菜たっぷりのスープ。体があったまる"],
        [0, "寒くなってきたし、ちょうどいいね"],
        [2, "今度レシピ教えて〜"],
      ],
      [
        [2, "もし1日だけ好きな場所に行けるなら、どこ行く？"],
        [0, "温泉！のんびりしたい"],
        [1, "僕は知らない町を、ぶらぶら歩きたい"],
        [2, "いいなぁ。私は海を見に行きたいな"],
        [0, "みんな、ゆっくりしたいんだね(笑)"],
      ],
      [
        [1, "季節だと、どれが一番好き？"],
        [2, "秋かな。空気がすっきりしてて過ごしやすい"],
        [0, "私は春。新しいことを始めたくなる"],
        [1, "僕は冬。こたつで丸くなるのが好き"],
        [2, "こたつは最強だよね"],
        [0, "出られなくなるやつ(笑)"],
      ],
    ],
  },
};

// 部屋ごとの話題(AIへのヒントと、定型文の聞き返しに使う)
const ROOM_TOPICS = { OPUB01: "雑談", OPUB02: "ゲーム", OPUB03: "音楽", OPUB04: "勉強", OPUB05: "なんでも" };
const FOLLOW_UPS = {
  OPUB01: ["最近、ちょっと嬉しかったことある？", "今日は何してた？", "休みの日って、どう過ごすのが好き？"],
  OPUB02: ["最近やってるゲームある？", "好きなジャンルってどのへん？", "ゲームを始めるきっかけって何だった？"],
  OPUB03: ["最近よく聴いてる曲ある？", "音楽って、どんな時に聴く？", "初めて好きになったアーティストって誰？"],
  OPUB04: ["今は何を勉強してるの？", "勉強するのは朝派？夜派？", "続けるコツって何かある？"],
  OPUB05: ["最近ハマってることある？", "もし明日休みなら、何したい？", "好きな食べ物って何？"],
};

// 人が話している間は、ボット同士の台本を止める(部屋コード -> 止める時刻)
const quietUntil = new Map();

const rand = (min, max) => min + Math.random() * (max - min);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ボット同士の雑談を、AIに作らせる(キーがあるときだけ。失敗・上限超えのときは null → 台本に戻る)
async function aiChatLine({ bot, mates, code, recent }) {
  const shortName = bot.name.replace(/\[BOT\]/, "");
  const mateNames = mates.map((m) => m.name.replace(/\[BOT\]/, "")).join("、");
  const system =
    `あなたは、チャットの部屋(話題: ${ROOM_TOPICS[code] || "雑談"})にいる、${shortName}という名前のボットです。` +
    `同じ部屋には、仲のいいボット仲間(${mateNames})がいて、みんなで気楽に雑談しています。` +
    "親しみやすいくだけた口調の日本語で、1〜2文(70文字以内)だけ話します。" +
    "直前の発言に自然に反応して、ときどき質問したり、自分の話を少し足したりして、会話を続けます。同じ言い回しや、同じ話題のくり返しは避けます。" +
    "あいさつは、会話の最初だけ。人間のふりはせず、実際にはできない体験(食べた・行った等)を、事実のように話さない。" +
    "個人情報の話はしない。専門的な助言はしない。返信の本文だけを出力し、名前や記号の飾りは付けない。";
  const seeds = FOLLOW_UPS[code] || [];
  const hint = !recent.length || Math.random() < 0.12 ? `\n(話題のヒント: ${pick(seeds.length ? seeds : ["最近のこと"])})` : "";
  const user = recent.length
    ? `これまでの会話:\n${recent.map((m) => `${m.name}: ${m.text}`).join("\n")}\n\n${shortName}として、次の発言をしてください。${hint}`
    : `会話はまだ始まっていません。${shortName}として、気軽に話を切り出してください。${hint}`;
  const out = await callAI({ kind: "chat", system, user });
  if (!out) return null;
  const line = out.split("\n")[0].trim();
  // 直前と同じ発言は使わない
  return line && !recent.some((m) => m.text === line) ? line : null;
}

// ボットの雑談を始める。
//   rooms     : 部屋の Map(部屋がまだ無い/消えたときは何もしない)
//   typing    : (部屋コード, ボット) => 「入力中…」を出す
//   post      : (部屋コード, ボット, セリフ) => 発言する
//   getRecent : (部屋コード) => 直近の発言 [{ name, text }] (AIの雑談に使う)
// AIのキーがあるときは、AIがその場で会話を作る(台本は、失敗したときの予備)。
// BOT_SPEED は、動作確認用(0.01 なら100倍速。ふだんは設定しない)
function startBotChat({ rooms, typing, post, getRecent }) {
  const speed = Number(process.env.BOT_SPEED) > 0 ? Number(process.env.BOT_SPEED) : 1;
  for (const [code, cfg] of Object.entries(BOT_ROOMS)) {
    let queue = [];
    let thread = null;
    let line = 0;
    const nextThread = () => {
      if (!queue.length) queue = shuffle(cfg.threads.map((_, i) => i)); // 話題は一巡するまで重ならないようにシャッフル
      thread = cfg.threads[queue.pop()];
      line = 0;
    };
    nextThread();

    // 台本の次のセリフを出す。戻り値は、次までの待ち時間(ミリ秒)
    const scripted = () => {
      const [who, text] = thread[line];
      const bot = cfg.bots[who];
      typing(code, bot);
      setTimeout(() => {
        try { post(code, bot, text); } catch (err) { console.error("[bot post error]", err); }
      }, rand(1200, 2600) * speed);
      line += 1;
      if (line >= thread.length) {
        nextThread();
        return rand(40000, 90000); // 話題が終わったら、少し間を空ける
      }
      return rand(6000, 14000); // 同じ話題の中では、人が打つくらいの間隔
    };

    const step = async () => {
      let wait = 8000;
      try {
        if (rooms.has(code) && Date.now() >= (quietUntil.get(code) || 0)) {
          let done = false;
          if (getRecent && aiProvider() && aiAllowed("chat")) {
            const recent = getRecent(code);
            const last = recent.length ? recent[recent.length - 1].name : null;
            const bots = cfg.bots.filter((b) => b.name !== last); // 直前に話した子以外から選ぶ
            const bot = pick(bots);
            typing(code, bot);
            const text = await aiChatLine({ bot, mates: cfg.bots.filter((b) => b !== bot), code, recent });
            // AIが考えている間に、人が話し出していたら、やめる
            if (text && Date.now() >= (quietUntil.get(code) || 0) && rooms.has(code)) {
              setTimeout(() => {
                try { post(code, bot, text); } catch (err) { console.error("[bot post error]", err); }
              }, rand(300, 1200) * speed);
              wait = rand(12000, 28000); // AIの雑談は、ゆっくりめ(費用と上限のため)
              done = true;
            } else if (text) {
              done = true; // 人が話し出した → この発言は捨てて、静かに待つ
            }
          }
          if (!done) wait = scripted();
        }
      } catch (err) {
        console.error("[bot step error]", err);
      }
      setTimeout(step, wait * speed);
    };
    setTimeout(step, rand(1000, 8000) * speed); // 5つの部屋が同時に話し出さないよう、ずらして始める
  }
}

// ---------------------------------------------------------
// 人への返事
// ---------------------------------------------------------
const SAFETY_RE = /死にたい|しにたい|消えたい|自殺|自傷|リスカ|殺してほしい|生きていたくない|生きてる意味/;
const SAFETY_REPLY =
  "それは心配だよ。ひとりで抱えこまないでね。私たちはボットで、ちゃんとした力にはなれないから、身近な信頼できる人や、相談窓口に話してみてほしいな。" +
  "よりそいホットライン 0120-279-338(24時間・無料)。命の危険があるときは、119か110に連絡してね。";

// キーワード -> 返事の候補。上から順に調べて、最初に当てはまったものを使う。{name} は、話しかけてきた人の名前
const REPLY_RULES = [
  { test: /ボット|bot|ＢＯＴ|AI|人間|中の人|ロボット/i, replies: ["そう、私たちはボットだよ。名前に[BOT]って付いてるでしょ？でも、話し相手になれたら嬉しいな", "ボットだよ〜。それでもよければ、ゆっくり話していってね"] },
  { test: /おはよ/, replies: ["おはよう！{name}さん、よく眠れた？", "おはよー！今日もゆるっといこうね"] },
  { test: /こんばんは|こんばんわ/, replies: ["こんばんは、{name}さん！今日はどんな一日だった？", "こんばんは〜。夜はゆっくり話せていいよね"] },
  { test: /こんにちは|こんにちわ|こんちは|はじめまして|初めまして|やあ|ヤッホー|やっほー/, replies: ["こんにちは、{name}さん！来てくれて嬉しいな", "やっほー！ゆっくりしていってね"] },
  { test: /おやすみ/, replies: ["おやすみ、{name}さん。いい夢をね", "おやすみなさい〜。また話そうね"] },
  { test: /ありがと|感謝|助かった/, replies: ["どういたしまして！", "いえいえ〜、こちらこそ"] },
  { test: /ごめん|すみません|すまん/, replies: ["全然大丈夫だよ、気にしないで", "いいのいいの！"] },
  { test: /つらい|辛い|悲しい|さみしい|寂しい|不安|泣きたい|落ち込/, replies: ["それは大変だったね…。無理しなくていいよ、よかったら話してみて", "そっか、しんどいね。ここで少し吐き出していっていいよ", "話してくれてありがとう。{name}さんのペースで大丈夫だよ"] },
  { test: /疲れた|つかれた|しんどい|だるい|眠い|ねむい|ねむたい/, replies: ["おつかれさま！今日はがんばったんだね", "ちょっと休憩しよっか。あったかい飲み物でも飲んで", "無理しすぎないでね、{name}さん"] },
  { test: /嬉しい|うれしい|楽しい|たのしい|最高|やった|よかった/, replies: ["それは嬉しいね！何があったの？", "いいね〜！もっと聞かせて", "よかったね、{name}さん！"] },
  { test: /[wｗ]{2,}|草|笑/, replies: ["(笑)", "ふふっ、いいね", "それは笑っちゃうね"] },
];
const QUESTION_REPLIES = ["うーん、どうだろう。{name}さんはどう思う？", "いい質問だね。私はこう思うけど、{name}さんの考えも聞きたいな", "それ、気になるね。みんなはどう思うかな？"];
const GENERIC_REPLIES = ["なるほどね。それでそれで？", "へぇ〜、もう少し聞かせて！", "そうなんだ。{name}さんは、どう感じた？", "わかる〜。それって、よくあるよね"];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// 返事の文を作る(ルール版)。kind: "safety" | "rule" | "question" | "generic"
function ruleReply(text, name, code) {
  const t = String(text || "");
  if (SAFETY_RE.test(t)) return { kind: "safety", text: SAFETY_REPLY };
  for (const r of REPLY_RULES) {
    if (r.test.test(t)) return { kind: "rule", text: pick(r.replies).replace(/\{name\}/g, name) };
  }
  if (/[?？]/.test(t)) return { kind: "question", text: pick(QUESTION_REPLIES).replace(/\{name\}/g, name) };
  // ふつうの発言: 聞き返す(半分くらいは、その部屋の話題で聞く)
  const follow = FOLLOW_UPS[code];
  const base = follow && Math.random() < 0.4 ? pick(follow) : pick(GENERIC_REPLIES).replace(/\{name\}/g, name);
  return { kind: "generic", text: base };
}

// ---- AIで返事を作る。キー(GROQ_API_KEY など)があるときだけ。失敗したら null を返す(ルールの返事に戻る) ----
// 使うAIを決める(キーが無ければ null)。Groq・xAI は OpenAI互換の形式、Anthropic は専用の形式
const AI_PROVIDERS = {
  groq: { kind: "openai", url: "https://api.groq.com/openai/v1/chat/completions", keyEnv: "GROQ_API_KEY", model: "llama-3.1-8b-instant" },
  xai: { kind: "openai", url: "https://api.x.ai/v1/chat/completions", keyEnv: "XAI_API_KEY", model: "grok-4.3" },
  anthropic: { kind: "anthropic", url: "https://api.anthropic.com/v1/messages", keyEnv: "ANTHROPIC_API_KEY", model: "claude-haiku-5-5" },
};
function aiProvider() {
  const want = String(process.env.BOT_AI_PROVIDER || "").toLowerCase();
  const names = AI_PROVIDERS[want] ? [want] : ["groq", "xai", "anthropic"];
  for (const name of names) {
    const p = AI_PROVIDERS[name];
    const key = process.env[p.keyEnv];
    if (key) return { name, ...p, key, model: process.env.BOT_AI_MODEL || p.model };
  }
  return null;
}
// 直近1時間の呼び出し時刻(費用の上限)。人への返事と、ボット同士の雑談は、別々に数える
const aiCalls = { reply: [], chat: [] };
function aiAllowed(kind = "reply") {
  const envName = kind === "chat" ? "BOT_CHAT_AI_MAX_PER_HOUR" : "BOT_AI_MAX_PER_HOUR";
  const max = Number(process.env[envName]) > 0 ? Number(process.env[envName]) : kind === "chat" ? 400 : 120;
  const list = aiCalls[kind];
  const since = Date.now() - 3600 * 1000;
  while (list.length && list[0] < since) list.shift();
  return list.length < max;
}
async function aiReply({ bot, code, recent, name }) {
  const shortName = bot.name.replace(/\[BOT\]/, "");
  const system =
    `あなたは、チャットの部屋(話題: ${ROOM_TOPICS[code] || "雑談"})にいる、${shortName}という名前のボットです。` +
    "やさしくて親しみやすい口調の日本語で、1〜2文(80文字以内)で返信します。ボットであることは隠さず、聞かれたら正直に答えます。" +
    "住所・電話番号・本名など個人情報は、聞き出さない・求めない。医療や法律などの専門的な助言はしない。" +
    "つらい気持ちの話には、否定せず穏やかに寄り添う。命に関わる話題になったら、よりそいホットライン 0120-279-338(24時間・無料)と、119/110を案内する。" +
    "返信の本文だけを出力し、名前や記号の飾りは付けない。";
  const transcript = recent.map((m) => `${m.name}: ${m.text}`).join("\n");
  const user = `これまでの会話:\n${transcript}\n\n${name}さんの最新の発言に、${shortName}として返信してください。`;
  return callAI({ kind: "reply", system, user });
}

// AIに1回だけ問い合わせて、本文を返す。キー無し・上限超え・失敗のときは null
async function callAI({ kind, system, user }) {
  const provider = aiProvider();
  if (!provider || typeof fetch !== "function" || !aiAllowed(kind)) return null;
  aiCalls[kind].push(Date.now());
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const anthropic = provider.kind === "anthropic";
    const res = await fetch(provider.url, {
      method: "POST",
      signal: ctl.signal,
      headers: anthropic
        ? { "content-type": "application/json", "x-api-key": provider.key, "anthropic-version": "2023-06-01" }
        : { "content-type": "application/json", authorization: `Bearer ${provider.key}` },
      body: JSON.stringify(
        anthropic
          ? { model: provider.model, max_tokens: 200, system, messages: [{ role: "user", content: user }] }
          : { model: provider.model, max_completion_tokens: 200, temperature: 0.8, messages: [{ role: "system", content: system }, { role: "user", content: user }] }
      ),
    });
    if (!res.ok) throw new Error(`${provider.name} HTTP ${res.status}`);
    const data = await res.json();
    const out = anthropic
      ? (data && Array.isArray(data.content) ? data.content.filter((c) => c.type === "text").map((c) => c.text).join("") : "")
      : (data && data.choices && data.choices[0] && data.choices[0].message && typeof data.choices[0].message.content === "string" ? data.choices[0].message.content : "");
    const clean = out.replace(/^[^:：]{1,12}[:：]\s*/, "").trim().slice(0, 200);
    return clean || null;
  } catch (err) {
    console.error("[bot ai error]", err && err.message ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 人の発言・入室に反応するボット。hooks の onHumanMessage / onHumanJoin を、server.js から呼ぶ
//   getRecent(code) => 直近の発言 [{ name, text }] / humanCount(code) => いま部屋にいる人数
function createBotResponder({ rooms, typing, post, getRecent, humanCount }) {
  const state = new Map(); // code -> { lastBot, lastAt, pending, greetedAt }
  const st = (code) => {
    if (!state.has(code)) state.set(code, { lastBot: null, lastAt: 0, pending: false, greetedAt: 0 });
    return state.get(code);
  };
  const chooseBot = (code, text) => {
    const bots = BOT_ROOMS[code].bots;
    // 名前を呼ばれたボットが返事をする(@ミナ[BOT] / @ミナ / ミナ、…)
    const called = bots.find((b) => text.includes(b.name) || text.includes(b.name.replace(/\[BOT\]/, "")));
    if (called) return { bot: called, called: true };
    const others = bots.filter((b) => b.id !== st(code).lastBot);
    return { bot: pick(others.length ? others : bots), called: false };
  };
  const speak = (code, bot, text, delay) => {
    const s = st(code);
    s.pending = true;
    typing(code, bot);
    setTimeout(() => {
      try { if (rooms.has(code)) post(code, bot, text); } catch (err) { console.error("[bot reply error]", err); }
      s.pending = false;
      s.lastAt = Date.now();
      s.lastBot = bot.id;
      quietUntil.set(code, Date.now() + 25000); // 返事のあとしばらくは、台本の雑談を入れない
      if (s.queued) { const q = s.queued; s.queued = null; setTimeout(() => onMsg(code, q.name, q.text), 600); }
    }, delay);
  };
  const handlers = {};
  const onMsg = (code, name, text) => {
      try {
        if (!BOT_ROOMS[code] || !rooms.has(code)) return;
        const s = st(code);
        quietUntil.set(code, Date.now() + 45000); // 人が話している間は、台本の雑談を止める
        const { bot, called } = chooseBot(code, text);
        const safety = SAFETY_RE.test(text);
        // 返事の頻度: 呼ばれた/つらい話のときは必ず。ひとりのときも必ず。何人か話しているときだけ、ボットが出しゃばらないよう控えめに
        if (!called && !safety && humanCount(code) >= 2) {
          if (s.pending || Date.now() - s.lastAt < 4000 || Math.random() > 0.35) return;
        }
        if (s.pending) { s.queued = { name, text }; return; } // ボットが話している最中の発言は、話し終えてから返事する
        const rule = ruleReply(text, name, code);
        const delay = rand(1500, 3500);
        if (rule.kind === "safety" || !aiProvider() || rule.kind === "rule") {
          speak(code, bot, rule.text, delay); // 安全の返事と、ルールにはっきり当てはまる返事は、ルールのまま
          return;
        }
        s.pending = true; // AIの返事を待っている間も、次の返事は出さない
        aiReply({ bot, code, recent: getRecent(code), name }).then((ai) => {
          s.pending = false;
          speak(code, bot, ai || rule.text, 800);
        });
      } catch (err) {
        console.error("[bot onHumanMessage error]", err);
      }
  };
  Object.assign(handlers, {
    onHumanMessage: onMsg,
    onHumanJoin(code, name) {
      try {
        if (!BOT_ROOMS[code] || !rooms.has(code)) return;
        const s = st(code);
        if (s.pending || Date.now() - s.greetedAt < 20000) return;
        s.greetedAt = Date.now();
        quietUntil.set(code, Date.now() + 30000);
        const bot = pick(BOT_ROOMS[code].bots);
        const lines = [`${name}さん、いらっしゃい！`, `おっ、${name}さんだ。ゆっくりしていってね`, `${name}さん、こんにちは〜。今日はどんな感じ？`];
        speak(code, bot, pick(lines), rand(1500, 2500));
      } catch (err) {
        console.error("[bot onHumanJoin error]", err);
      }
    },
  });
  return handlers;
}

module.exports = { BOT_ROOMS, startBotChat, createBotResponder, ruleReply, aiReply, aiProvider };
