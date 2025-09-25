<<<<<<< HEAD
# RecoRuCheck

# "mode": 1 だったら、実際に処理を行う。２だったら、ログだけを残す。
=======
##このツールについて
このツールは、勤怠管理システムRecoRu上での「チェック」作業を自動化する Node.js スクリプトです。  
実行時に対象の部署と年月を入力すると、各社員のデータを確認し以下を行います。
- エラーがある場合 → 社員情報とエラー内容をログに記録  
- エラーがない場合 → 「確定２」チェック後、必要に応じて「更新」処理を実行  
- 実行結果は `.txt` ログファイルとして保存され、指定メールアドレス宛に送信


## 実行方法
1. `config.json` を設定する  
2. `start_recoru.bat` をダブルクリックして起動する  
3. 部署番号・年月を入力する  


##config.jsonの設定方法
1.「mode」は、RecoRu で「確定２」チェックおよび「更新」を実行するかどうかを定める設定です。
-'1'にすると「更新」まで行います。
-'2'にすると「更新」はせず、勤怠記録のチェックのみを行います。
2.「headless」は、処理過程を画面に表示するかどうかの設定です。
-'true'にすると、ブラウザを開かずバックグラウンドで処理が実行されます。
-'false'にすると、実際のブラウザ操作を表示しながら処理が進みます。
3.「recoru」は、ログイン時に使用するアカウント情報の設定です。
4.「from」は、メール送信に使用する LINE アドレスと外部アプリパスワードの設定です。
外部アプリパスワードは以下の URL から作成してください:
https://common.worksmobile.com/security-settings/app-password
5.「mail」は、処理結果（txtファイル）を送信する宛先メールアドレスです。
6.「error」は、処理結果の txt ファイルを保存するディレクトリです。
基本的には exe と同じディレクトリ内に作成されます。
7.「edge」は、Microsoft Edge がインストールされているディレクトリの設定です。
8.「profile」は、Chrome プロファイル（拡張機能が格納されているディレクトリ）の設定です。
9.「extensions」は、RecoRu の「チェック」拡張機能が格納されているディレクトリの設定です。


##実行前の事前準備
このツールは Google Chrome ではなく Microsoft Edge 上で RecoRu の「チェック」拡張機能を利用します。
そのため、事前に Edge に拡張機能を追加・有効化しておく必要があります。
1.Microsoft Edge を開いてください。
2.以下の URL にアクセスしてください：
https://chromewebstore.google.com/detail/upload-recoru-checker/bnpbipoagoppnfbeohpjecioikehbbpj?utm_source=ext_app_menu
3.表示されたページから UPLOAD Recoru Checker を拡張機能として追加してください。
4.Edge のメニュー → 拡張機能 → 拡張機能の管理を開き、UPLOAD Recoru Checkerをオンにしてください。
5.Edge 画面の右上に UPLOAD Recoru Checker のアイコンが追加されていることを確認してください。
>>>>>>> 9849f5e9e7280ba0ac631c2c9de4abbb308ba76d
