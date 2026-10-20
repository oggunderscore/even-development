// Runs inside the simulator's webview before the app: fake Deepgram sockets and a fake model, driven by /__poll commands.
;(function () {
  const PRESET = __PRESET__
  const log = (m) => { try { navigator.sendBeacon('/__log', String(m)) } catch (e) {} }
  window.addEventListener('error', (e) => log('error ' + e.message))
  window.addEventListener('unhandledrejection', (e) => log('rejection ' + (e.reason && e.reason.message)))

  const settings = {
    schema: 2,
    deepgramKey: 'dg-demo-key-0123456789',
    provider: 'openrouter',
    openrouterKey: 'or-demo-key-0123456789',
    openrouterModel: '',
    mode: PRESET === 'predictive' ? 'predictive' : 'standard',
    replyStyle: 'polite',
    jpLevel: 'beginner',
    maxOptions: 3,
    voiceFilter: true,
    glassesKana: false,
  }
  try { localStorage.setItem('honyaku.settings.v1', JSON.stringify(settings)) } catch (e) {}

  // ---- the "model": what a good one answers for each line of the demo conversation ----
  const HEARD = {
    'こんにちは、いらっしゃいませ。': ['Hello, welcome.', 'konnichiwa, irasshaimase.'],
    'ご注文はお決まりですか？': ['Are you ready to order?', 'gochuumon wa okimari desu ka?'],
    'ホットとアイス、どちらになさいますか？': ['Hot or iced?', 'hotto to aisu, dochira ni nasaimasu ka?'],
    '店内でお召し上がりですか？お持ち帰りですか？': ['For here, or to go?', 'tennai de omeshiagari desu ka? omochikaeri desu ka?'],
    '六百五十円です。現金ですか、カードですか？': ['That is 650 yen. Cash or card?', 'roppyaku gojuu en desu. genkin desu ka, kaado desu ka?'],
    'ありがとうございました。またお越しください。': ['Thank you very much. Please come again.', 'arigatou gozaimashita. mata okoshi kudasai.'],
    '駅ですか？この道をまっすぐ行って、二つ目の信号を右に曲がってください。': ['The station? Go straight and turn right at the second light.', 'eki desu ka? kono michi o massugu itte, futatsume no shingou o migi ni magatte kudasai.'],
    '歩いて十分ぐらいですよ。': ["It's about ten minutes on foot.", 'aruite juppun gurai desu yo.'],
    'アレルギーはありますか？': ['Do you have any allergies?', 'arerugii wa arimasu ka?'],
  }
  const SPOKEN = {
    'Two coffees, please.': ['コーヒーを二つお願いします。', 'koohii o futatsu onegaishimasu.'],
    "I'll pay by card.": ['カードでお願いします。', 'kaado de onegaishimasu.'],
    'Excuse me, where is the station?': ['すみません、駅はどこですか？', 'sumimasen, eki wa doko desu ka?'],
    'This is delicious.': ['おいしいです。', 'oishii desu.'],
  }
  const REPLIES = {
    'こんにちは、いらっしゃいませ。': ['single', ['Hello', 'konnichiwa']],
    'ご注文はお決まりですか？': ['choice', ['Coffee, please', 'koohii o onegaishimasu'], ['Tea, please', 'ocha o onegaishimasu'], ['One moment', 'sukoshi matte kudasai']],
    'ホットとアイス、どちらになさいますか？': ['choice', ['Hot, please', 'hotto de onegaishimasu'], ['Iced, please', 'aisu de onegaishimasu']],
    '店内でお召し上がりですか？お持ち帰りですか？': ['choice', ['For here', 'koko de tabemasu'], ['To go', 'mochikaeri de onegaishimasu']],
    '六百五十円です。現金ですか、カードですか？': ['choice', ['Cash', 'genkin de onegaishimasu'], ['Card', 'kaado de onegaishimasu']],
    'ありがとうございました。またお越しください。': ['single', ['Thank you', 'arigatou gozaimashita']],
    '駅ですか？この道をまっすぐ行って、二つ目の信号を右に曲がってください。': ['single', ['Got it, thank you', 'wakarimashita, arigatou gozaimasu']],
    '歩いて十分ぐらいですよ。': ['single', ['Thanks, that is close', 'arigatou gozaimasu, chikai desu ne']],
    'アレルギーはありますか？': ['choice', ['No allergies', 'arerugii wa arimasen'], ['Yes, I do', 'hai, arimasu']],
  }

  const enc = new TextEncoder()
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  function sse(text) {
    const pieces = text.match(/[\s\S]{1,6}/g) || []
    let i = 0
    return new Response(new ReadableStream({
      async pull(c) {
        await sleep(120)
        if (i === 0) c.enqueue(enc.encode(': OPENROUTER PROCESSING\n\n'))
        if (i >= pieces.length) { c.enqueue(enc.encode('data: [DONE]\n\n')); return c.close() }
        c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: pieces[i++] } }] }) + '\n\n'))
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const plain = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 })

  const realFetch = window.fetch.bind(window)
  window.fetch = async function (url, init) {
    const u = String(url)
    if (u.startsWith('https://openrouter.ai/api/v1/key')) return new Response('{}', { status: 200 })
    if (u.startsWith('https://openrouter.ai/api/v1/chat/completions')) {
      const body = JSON.parse(init.body)
      const system = body.messages[0].content
      const user = body.messages[1].content
      let text
      if (system.indexOf('Line 1: single') >= 0) {
        const heard = (user.split('The other person just said:\n')[1] || '').trim()
        const r = REPLIES[heard] || ['single', ['Okay', 'wakarimashita']]
        text = r[0] + '\n' + r.slice(1).map((o) => o[0] + ' | ' + o[1]).join('\n')
        await sleep(450)
      } else if (system.indexOf('JA:') >= 0) {
        const said = user.split('\n').pop().trim()
        const r = SPOKEN[said] || ['はい', 'hai']
        text = 'JA: ' + r[0] + '\nROMAJI: ' + r[1]
        await sleep(350)
      } else {
        const heard = user.split('\n').pop().trim()
        const r = HEARD[heard] || ['Okay.', 'hai.']
        text = 'EN: ' + r[0] + (system.indexOf('ROMAJI:') >= 0 ? '\nROMAJI: ' + r[1] : '')
        await sleep(300)
      }
      return body.stream ? sse(text) : plain(text)
    }
    return realFetch(url, init)
  }

  // ---- fake Deepgram ----
  const sockets = []
  class FakeWS {
    constructor(url) {
      this.url = String(url)
      this.lang = /language=(\w+)/.exec(this.url)[1]
      this.readyState = 0
      this.binaryType = 'blob'
      sockets.push(this)
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}) }, 60)
    }
    send() {}
    close() { this.readyState = 3; const i = sockets.indexOf(this); if (i >= 0) sockets.splice(i, 1); this.onclose && this.onclose({}) }
    emit(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
  }
  FakeWS.OPEN = 1; FakeWS.CONNECTING = 0; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3
  window.WebSocket = FakeWS

  let clock = 0
  function say(lang, text, final) {
    const start = clock
    const dur = Math.max(1.5, text.length * 0.12)
    for (const s of sockets.filter((x) => x.lang === lang)) {
      s.emit({ type: 'Results', is_final: !!final, start, duration: dur, channel: { alternatives: [{ transcript: text, confidence: 0.96 }] } })
    }
    if (final) clock += dur + 0.4
  }
  async function run(cmd) {
    if (cmd.t === 'say') {
      const words = cmd.text
      say(cmd.lang, words.slice(0, Math.ceil(words.length / 2)), false) // an interim first, as a real recogniser does
      await sleep(250)
      say(cmd.lang, words, true)
    }
  }
  setInterval(async () => {
    try {
      const cmds = await (await realFetch('/__poll')).json()
      for (const c of cmds) await run(c)
    } catch (e) {}
  }, 120)
  log('harness ready ' + PRESET)
})()
