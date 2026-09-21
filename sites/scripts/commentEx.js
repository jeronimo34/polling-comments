/*
@config : connectionSetting.json
@filename : commentEx.js
@title : commentEx
@name : commentEx
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

    // メンション通知の保存先サイト (CommentMentions)
    const MENTIONS_SITE_ID = 458;
    // リアクションの保存先サイト (CommentReactions)
    const REACTIONS_SITE_ID = 459;
    const MENTION_DROPDOWN_ID = 'commentExMentionDropdown';
    const COMMENT_EX_STYLE_ID = 'commentExStyle';
    const REACTION_TYPES = [
        { value: 'Like', emoji: '👍', title: 'いいね' },
        { value: 'Confirmed', emoji: '✅', title: '確認しました' },
        { value: 'Thanks', emoji: '🙏', title: 'ありがとう' }
    ];

    let pollingTimerId;
    let fetching = false;
    // 更新ボタン押下時に入力されていたコメント本文(採番前のコメントIDと結び付けるまで保持する)
    let pendingMentionText;

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

    // メンション候補一覧・リアクションボタンの見た目用CSSを1度だけ追加する
    function ensureCommentExStyle() {
        if (document.getElementById(COMMENT_EX_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = COMMENT_EX_STYLE_ID;
        style.textContent =
            '.comment-ex-mention-dropdown{list-style:none;margin:0;padding:4px 0;background:#fff;' +
            'border:1px solid #ccc;border-radius:4px;box-shadow:0 2px 6px rgba(0,0,0,.2);max-height:200px;overflow-y:auto;}' +
            '.comment-ex-mention-dropdown li{padding:4px 12px;cursor:pointer;white-space:nowrap;}' +
            '.comment-ex-mention-dropdown li:hover{background:#e8f0fe;}' +
            '.comment-ex-reactions{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;}' +
            '.comment-ex-reaction-btn{border:1px solid #ccc;border-radius:12px;background:#fff;' +
            'padding:2px 8px;font-size:12px;cursor:pointer;}' +
            '.comment-ex-reaction-btn.is-mine{background:#e8f0fe;border-color:#4a89dc;}';
        document.head.appendChild(style);
    }

    // コメントラッパーのid("CommentNN.wrapper")からコメントIDを取り出す
    function extractCommentId(wrapperId) {
        const match = /^Comment(\d+)\.wrapper$/.exec(wrapperId || '');
        return match ? Number(match[1]) : undefined;
    }

    // 担当者・管理者のドロップダウンからメンション候補となるユーザー一覧を集める
    function getUserDirectory() {
        const users = [];
        const seen = {};
        $('#Results_Owner option, #Results_Manager option').each(function () {
            const id = Number($(this).val());
            const name = $(this).text().trim();
            if (id && name && !seen[id]) {
                seen[id] = true;
                users.push({ id: id, name: name });
            }
        });
        return users;
    }

    function excerptOf(text, maxLen) {
        const trimmed = (text || '').trim();
        return trimmed.length > maxLen ? trimmed.substring(0, maxLen) + '…' : trimmed;
    }

    // コメント本文に含まれる「@ユーザー名」を検出してメンション通知を作成する
    function registerMentions(commentText, commentId) {
        const recordId = $p.id();
        const recordTitle = $('#Results_Title').val() || '';
        const excerpt = excerptOf(commentText, 100);
        const directory = getUserDirectory();
        console.log('[CommentEx] registerMentions called', { commentText: commentText, commentId: commentId, recordId: recordId, directory: directory });
        const mentioned = directory.filter(function (user) {
            return commentText.indexOf('@' + user.name) !== -1;
        });
        console.log('[CommentEx] mentioned users', mentioned);
        mentioned.forEach(function (user) {
            $p.apiCreate({
                id: MENTIONS_SITE_ID,
                data: {
                    Owner: user.id,
                    NumHash: { NumA: recordId, NumB: commentId },
                    ClassHash: { ClassA: excerpt, ClassB: recordTitle }
                },
                done: function (res) {
                    console.log('[CommentEx] mention apiCreate done', user, res);
                },
                fail: function (res) {
                    console.log('[CommentEx] mention apiCreate fail', user, res);
                }
            });
        });
    }

    function closeMentionDropdown() {
        $('#' + MENTION_DROPDOWN_ID).remove();
    }

    function showMentionDropdown($comments, users, matchLength) {
        closeMentionDropdown();
        const $dropdown = $('<ul>', { id: MENTION_DROPDOWN_ID, class: 'comment-ex-mention-dropdown' });
        users.forEach(function (user) {
            $('<li>').text(user.name).appendTo($dropdown);
        });
        // clickより先にtextareaのblurが発火して候補が消えてしまうのを防ぐ
        $dropdown.on('mousedown', 'li', function (e) {
            e.preventDefault();
            insertMention($comments, $(this).text(), matchLength);
            closeMentionDropdown();
        });
        const offset = $comments.offset();
        $dropdown.css({
            position: 'absolute',
            top: offset.top + $comments.outerHeight(),
            left: offset.left,
            zIndex: 1000
        });
        $('body').append($dropdown);
    }

    function insertMention($comments, userName, matchLength) {
        const el = $comments.get(0);
        const caret = el.selectionStart;
        const value = el.value;
        const before = value.substring(0, caret - matchLength);
        const after = value.substring(caret);
        const inserted = '@' + userName + ' ';
        // $p.set()を使うことで$p.data(送信対象の値)への反映も同時に行う
        $p.set($comments, before + inserted + after);
        const newCaret = before.length + inserted.length;
        el.setSelectionRange(newCaret, newCaret);
        el.focus();
    }

    // コメント欄で「@」を入力した際にユーザー名の候補を表示する
    function setupMentionAutocomplete() {
        const $comments = $('#Comments');
        if ($comments.length === 0 || $comments.data('commentExMentionBound')) {
            return;
        }
        $comments.data('commentExMentionBound', true);
        ensureCommentExStyle();
        $comments.on('input.commentExMention', function () {
            const el = this;
            const beforeCaret = el.value.substring(0, el.selectionStart);
            const match = /@([^\s@]*)$/.exec(beforeCaret);
            if (!match) {
                closeMentionDropdown();
                return;
            }
            const query = match[1].toLowerCase();
            const users = getUserDirectory()
                .filter(function (user) {
                    return user.name.toLowerCase().indexOf(query) !== -1;
                })
                .slice(0, 8);
            if (users.length === 0) {
                closeMentionDropdown();
                return;
            }
            showMentionDropdown($comments, users, match[0].length);
        });
        $comments.on('blur.commentExMention', function () {
            // 候補クリックの mousedown を先に処理させるため少し遅らせて閉じる
            setTimeout(closeMentionDropdown, 150);
        });
    }

    // コメント本文中の「@ユーザー名」を検知し、メンション通知を作成する
    function setupMentionRegistration() {
        // 送信後はClearFormData等でargs.data.Commentsが消えてしまうため、送信前に本文を保持しておく
        $p.events.before_send = function (args) {
            const isUpdate = args && args.$control && args.$control.attr('data-action') === 'Update';
            console.log('[CommentEx] before_send', { isUpdate: isUpdate, control: args && args.$control && args.$control.attr('id') });
            if (isUpdate) {
                const text = $('#Comments').val();
                pendingMentionText = text && text.trim() ? text : undefined;
                console.log('[CommentEx] pendingMentionText set to', pendingMentionText);
            }
        };
        // 更新応答自体が#MainContainerを丸ごと再描画するため、その応答(args.json)から
        // 直接コメント一覧の先頭(=今回投稿したコメント)のIDを取り出す
        $p.events.after_set = function (args) {
            const isUpdate = args && args.$control && args.$control.attr('data-action') === 'Update';
            console.log('[CommentEx] after_set', { isUpdate: isUpdate, pendingMentionText: pendingMentionText });
            if (!isUpdate || !pendingMentionText) {
                return;
            }
            const commentText = pendingMentionText;
            pendingMentionText = undefined;
            const replaceAll = Array.isArray(args.json) && args.json.find(function (item) {
                return item.Method === 'ReplaceAll' && item.Target === '#MainContainer';
            });
            if (!replaceAll) {
                console.log('[CommentEx] after_set: no ReplaceAll #MainContainer found');
                return;
            }
            const firstComment = $('<div>').html(replaceAll.Value).find('#CommentList').children().first();
            const commentId = extractCommentId(firstComment.attr('id'));
            console.log('[CommentEx] after_set: resolved commentId', commentId);
            if (commentId) {
                registerMentions(commentText, commentId);
            }
        };
    }

    // コメントに対するリアクションボタンをまだ無ければ追加する
    function ensureReactionButtons($comment) {
        let $bar = $comment.find('> .comment-ex-reactions');
        if ($bar.length > 0) {
            return $bar;
        }
        const commentId = extractCommentId($comment.attr('id'));
        if (!commentId) {
            return $();
        }
        $bar = $('<div>', { class: 'comment-ex-reactions', 'data-comment-id': commentId });
        REACTION_TYPES.forEach(function (type) {
            $('<button>', {
                type: 'button',
                class: 'comment-ex-reaction-btn',
                'data-reaction': type.value,
                title: type.title
            })
                .append($('<span>').text(type.emoji + ' '))
                .append($('<span>', { class: 'comment-ex-reaction-count' }).text('0'))
                .appendTo($bar);
        });
        $comment.append($bar);
        return $bar;
    }

    // このレコードの全コメントのリアクション集計を取得し、ボタンの表示を更新する
    function refreshReactions() {
        const $comments = $('#CommentList > .comment');
        if ($comments.length === 0) {
            return;
        }
        ensureCommentExStyle();
        // NumA等の数値項目の絞り込みは ["最小値,最大値"] という範囲指定形式で渡す必要がある
        const recordId = $p.id();
        const numRangeFilter = JSON.stringify([recordId + ',' + recordId]);
        $p.apiGet({
            id: REACTIONS_SITE_ID,
            data: { View: { ColumnFilterHash: { NumA: numRangeFilter } } },
            done: function (res) {
                // 応答は { Response: { Data: [...] } } で、拡張列は NumHash/ClassHash にネストされる
                const rows = (res && res.Response && res.Response.Data) || [];
                const byComment = {};
                rows.forEach(function (row) {
                    const commentId = row.NumHash && row.NumHash.NumB;
                    const type = row.ClassHash && row.ClassHash.ClassA;
                    const bucket = (byComment[commentId] = byComment[commentId] || {});
                    const info = (bucket[type] = bucket[type] || { count: 0, mine: false, rowId: undefined });
                    info.count++;
                    if (row.Creator === $p.userId()) {
                        info.mine = true;
                        info.rowId = row.ResultId || row.IssueId || row.Id;
                    }
                });
                $comments.each(function () {
                    const $comment = $(this);
                    const commentId = extractCommentId($comment.attr('id'));
                    const $bar = ensureReactionButtons($comment);
                    const state = byComment[commentId] || {};
                    $bar.find('.comment-ex-reaction-btn').each(function () {
                        const $btn = $(this);
                        const info = state[$btn.attr('data-reaction')] || { count: 0, mine: false };
                        $btn.find('.comment-ex-reaction-count').text(info.count);
                        $btn.toggleClass('is-mine', info.mine === true);
                        $btn.data('reactionRowId', info.rowId);
                    });
                });
            }
        });
    }

    // リアクションボタンのクリックで、自分の反応を作成/取り消しする
    function setupReactionButtons() {
        $(document).on('click.commentExReaction', '#CommentList .comment-ex-reaction-btn', function () {
            const $btn = $(this);
            const commentId = Number($btn.closest('.comment-ex-reactions').attr('data-comment-id'));
            const type = $btn.attr('data-reaction');
            const rowId = $btn.data('reactionRowId');
            if ($btn.hasClass('is-mine') && rowId) {
                $p.apiDelete({ id: rowId, done: refreshReactions });
            } else {
                $p.apiCreate({
                    id: REACTIONS_SITE_ID,
                    data: {
                        NumHash: { NumA: $p.id(), NumB: commentId },
                        ClassHash: { ClassA: type }
                    },
                    done: refreshReactions
                });
            }
        });
    }

    // コメント欄を再取得し、新着コメントの追加・リアクション更新・保留中のメンション登録を行う
    function pollComments() {
        const $commentList = $('#CommentList');
        if ($commentList.length === 0) {
            // コメント欄が画面上から無くなっていたらポーリングを停止する
            if (pollingTimerId) {
                clearInterval(pollingTimerId);
                pollingTimerId = undefined;
            }
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
            url: location.href,
            type: 'get',
            cache: false,
            dataType: 'json'
        }).done(function (json) {
            console.log('[CommentEx] pollComments response', json);
            if (!Array.isArray(json)) {
                return;
            }
            const replaceAll = json.find(function (item) {
                return item.Method === 'ReplaceAll' && item.Target === '#MainContainer';
            });
            if (!replaceAll) {
                console.log('[CommentEx] no ReplaceAll #MainContainer found in response');
                return;
            }
            const newCommentList = $('<div>').html(replaceAll.Value).find('#CommentList');
            if (newCommentList.length === 0) {
                return;
            }
            // 既存のコメント要素(投稿直後で編集可能な状態のものを含む)には触れず、
            // まだ画面に無い新着コメントだけを先頭側に追加する
            const newComments = newCommentList.children().get();
            let added = false;
            let newestAddedCommentId;
            for (let i = newComments.length - 1; i >= 0; i--) {
                const node = newComments[i];
                if (node.id && !document.getElementById(node.id)) {
                    added = true;
                    const commentId = extractCommentId(node.id);
                    if (commentId && (!newestAddedCommentId || commentId > newestAddedCommentId)) {
                        newestAddedCommentId = commentId;
                    }
                    ensureHighlightStyle();
                    const $node = $(node).hide().addClass(HIGHLIGHT_CSS_CLASS);
                    $commentList.prepend($node);
                    $node.slideDown(300);
                    setTimeout(function () {
                        $node.removeClass(HIGHLIGHT_CSS_CLASS);
                    }, HIGHLIGHT_DURATION);
                }
            }
            console.log('[CommentEx] poll result', { added: added, newestAddedCommentId: newestAddedCommentId, pendingMentionText: pendingMentionText });
            // 新着コメントにもリアクションボタンを付ける
            if (added) {
                refreshReactions();
            }
            // 更新ボタン押下時に保持しておいたコメント本文を、実際に採番された新着コメントIDと結び付ける
            if (pendingMentionText && newestAddedCommentId) {
                registerMentions(pendingMentionText, newestAddedCommentId);
                pendingMentionText = undefined;
            }
        }).always(function () {
            fetching = false;
        });
    }

    setupMentionRegistration();
    setupReactionButtons();

    $p.events.on_editor_load = function () {
        setupMentionAutocomplete();
        refreshReactions();
        // 編集画面が再読み込みされた際に多重実行しないよう、既存のタイマーを止めてから開始する
        if (pollingTimerId) {
            clearInterval(pollingTimerId);
            pollingTimerId = undefined;
        }
        if ($('#CommentList').length === 0) {
            return;
        }
        pollingTimerId = setInterval(pollComments, POLLING_INTERVAL);
    };
})();
