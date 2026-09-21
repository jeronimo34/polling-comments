/*
@config : connectionSetting.json
@filename : pollingComments.js
@title : pollingComments
@name : pollingComments
@siteIds : 455
@siteTitles : 記録テーブル
@disabled: false
*/

(function () {
    // コメント欄を自動更新する間隔(ミリ秒)
    const POLLING_INTERVAL = 10000;
    const HIGHLIGHT_STYLE_ID = 'pollingCommentsHighlightStyle';
    const HIGHLIGHT_CSS_CLASS = 'polling-comment-new';
    const HIGHLIGHT_DURATION = 1600;

    let pollingTimerId;
    let fetching = false;

    // 新着コメントをハイライトするアニメーション用のCSSを1度だけ追加する
    function ensureHighlightStyle() {
        if (document.getElementById(HIGHLIGHT_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = HIGHLIGHT_STYLE_ID;
        style.textContent =
            '@keyframes pollingCommentHighlight{from{background-color:#fff3b0;}to{background-color:transparent;}}' +
            '.' + HIGHLIGHT_CSS_CLASS + '{animation:pollingCommentHighlight ' + HIGHLIGHT_DURATION + 'ms ease-out;}';
        document.head.appendChild(style);
    }

    $p.events.on_editor_load = function () {
        // 編集画面が再読み込みされた際に多重実行しないよう、既存のタイマーを止めてから開始する
        if (pollingTimerId) {
            clearInterval(pollingTimerId);
            pollingTimerId = undefined;
        }

        const $commentList = $('#CommentList');
        if ($commentList.length === 0) {
            return;
        }

        const url = location.href;

        pollingTimerId = setInterval(function () {
            // コメント欄が画面上から無くなっていたらポーリングを停止する
            if (!document.body.contains($commentList[0])) {
                clearInterval(pollingTimerId);
                pollingTimerId = undefined;
                return;
            }
            // 前回の取得が完了していない場合は今回の取得をスキップする
            if (fetching) {
                return;
            }
            fetching = true;
            // 画面を再表示するだけの読み取り専用のリクエストなので、入力中のコメント下書きや他項目には影響しない
            // Pleasanterはajaxリクエストと判定するとHTMLではなく [{Method,Target,Value}, ...] 形式のJSONを返す
            $.ajax({
                url: url,
                type: 'get',
                cache: false,
                dataType: 'json'
            }).done(function (json) {
                if (!Array.isArray(json)) {
                    return;
                }
                const replaceAll = json.find(function (item) {
                    return item.Method === 'ReplaceAll' && item.Target === '#MainContainer';
                });
                if (!replaceAll) {
                    return;
                }
                const newCommentList = $('<div>').html(replaceAll.Value).find('#CommentList');
                if (newCommentList.length === 0) {
                    return;
                }
                // 既存のコメント要素(投稿直後で編集可能な状態のものを含む)には触れず、
                // まだ画面に無い新着コメントだけを先頭側に追加する
                const newComments = newCommentList.children().get();
                for (let i = newComments.length - 1; i >= 0; i--) {
                    const node = newComments[i];
                    if (node.id && !document.getElementById(node.id)) {
                        ensureHighlightStyle();
                        const $node = $(node).hide().addClass(HIGHLIGHT_CSS_CLASS);
                        $commentList.prepend($node);
                        $node.slideDown(300);
                        setTimeout(function () {
                            $node.removeClass(HIGHLIGHT_CSS_CLASS);
                        }, HIGHLIGHT_DURATION);
                    }
                }
            }).always(function () {
                fetching = false;
            });
        }, POLLING_INTERVAL);
    };
})();
