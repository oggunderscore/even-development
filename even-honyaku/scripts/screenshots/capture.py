from drive import *

def wait(s): time.sleep(s)

# ---------------- Standard mode ----------------
s = Session('standard')
try:
    shot('01-standard-first-launch-paused')
    key('click'); wait(2.5)
    shot('02-standard-listening')
    say('ja', 'こんにちは、いらっしゃいませ。'); wait(3)
    shot('03-standard-japanese-to-english')
    say('en', 'Two coffees, please.'); wait(3.5)
    shot('04-standard-english-to-romaji')
    say('ja', 'ホットとアイス、どちらになさいますか？'); wait(3)
    shot('05-standard-conversation')
finally:
    s.stop()

# ---------------- Predictive mode ----------------
s = Session('predictive')
try:
    key('click'); wait(2.5)
    shot('06-predictive-ready')
    say('ja', 'こんにちは、いらっしゃいませ。'); wait(4.5)
    shot('07-predictive-single-reply')
    wait(10.5)
    say('ja', 'ご注文はお決まりですか？'); wait(4.5)
    shot('08-predictive-choose-a-reply')
    key('down'); wait(1)
    shot('09-predictive-highlight-moved')
    wait(10)
    say('ja', 'ホットとアイス、どちらになさいますか？'); wait(4.5)
    shot('10-predictive-hot-or-iced')
    say('ja', 'アイスでお願いします'); wait(3)   # the wearer reads the second suggestion aloud
    shot('11-predictive-reply-read-aloud')
    wait(2)
    say('en', 'This is delicious.'); wait(3.5)
    shot('12-predictive-your-own-english-as-romaji')
    wait(10.5)
    say('ja', '駅ですか？この道をまっすぐ行って、二つ目の信号を右に曲がってください。'); wait(4.5)
    shot('13-predictive-directions')
    key('context_menu'); wait(1.5)
    shot('14-glasses-menu')
    key('context_menu'); wait(1)
finally:
    s.stop()
print('done')
