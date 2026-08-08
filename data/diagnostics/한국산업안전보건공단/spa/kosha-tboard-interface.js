(function() {
    window.tboardInterface = {
        TboardProgress: null
        , TboardMessage: null
        , TboardLogin: null
        , PrjtHandler: null
    };

    let TboardProgress = class {
        constructor(args) {            
            this.systemCd = args.systemCd;
            this.chnlId   = args.chnlId;
        }

        init(_type) {
            if (this.chnlId === "local") {
                return new this.Default();
            }
            else if (this.systemCd === "10") {
                return new this.ErpProgress();
            }
            else {
                return new this.PortalProgress();
            }
        }

        Default = class {
            setSpinner() {
                return;
            }

            removeSpinner() {
                return;
            }
        }

        ErpProgress = class {
            setSpinner() {
                let flag = true;
                try {
                    if (_application?.WorkFrame?._p_form?.setWaitCursor) {
                        _application.WorkFrame._p_form.setWaitCursor(true);
                    }
                }
                catch(error) {
                    flag = false;
                    this.removeSpinner();
                }
                return flag;
            }

            removeSpinner() {
                let flag = true;
                try {
                    if (_application?.WorkFrame?._p_form?.setWaitCursor) {
                        _application.WorkFrame._p_form.setWaitCursor(false);
                    }
                }
                catch(error) {
                    flag = false;
                }
                return flag;
            }
        }

        PortalProgress = class {
            setSpinner() {
                try {
                    let app = document.querySelector("[id='app']");
                    let loader = document.createElement("div");
                    if (!app || !loader) {
                        return;
                    }

                    loader.classList.add("popup");
                    loader.classList.add("loader");
                    loader.id = "tboard_loader";
                    
                    let span = document.createElement("span");
                    loader.appendChild(span);
                    app.appendChild(loader);
                } 
                catch(error) {
                    this.removeSpinner();
                }
            }

            removeSpinner() {
                let tboardLoader = document.querySelector("[id='tboard_loader']");
                if (tboardLoader) {
                    tboardLoader.remove();
                }
            }
        }
    },
    TboardMessage = class {
        constructor(args) {            
            this.systemCd = args.systemCd;
            this.chnlId   = args.chnlId;
        }

        init() {
            if (this.chnlId === "local") {
                return new this.Default();
            }
            else if (this.systemCd === "10") {
                return new this.ErpMessage();
            }
            else {
                return new this.PortalMessage();
            }
        }

        Default = class {
            tbAlert(_args) {
                let args = _args || {};
                if (!args.sMsgId) {
                    return;
                }
                if (!args.sPopId) {
                    args.sPopId = "tboard";
                }

                alert(args.sMsgId);
                if (typeof args.aCallBack === "function") {
                    args.aCallBack(args.sPopId, true);
                }
            }
    
            tbConfirm(_args) {
                let args = _args || {};
                if (!args.sMsgId) {
                    return;
                }

                if (!args.sPopId) {
                    args.sPopId = "tboard";
                }

                let result = confirm(args.sMsgId);
                if (typeof args.aCallBack === "function") {
                    args.aCallBack(args.sPopId, result);
                }
            }
        }

        ErpMessage = class {
            tbAlert(_args) {
                if (!_application || !kosha?.alert || typeof kosha.alert !== "function") {
                    return;
                }
                let args = _args || {};
                if (!args.sMsgId) {
                    return;
                }

                if (!args.sType) {
                    args.sType = "Info";
                }
                
                if (!args.sPopId) {
                    args.sPopId = "tboard";
                }

                kosha.alert(_application, args.sType, args.sMsgId, args.arrParam, args.sPopId, args.aCallBack);
            }
    
            tbConfirm(_args) {
                if (!_application || !kosha?.confirm || typeof kosha.confirm !== "function") {
                    return;
                }

                let args = _args || {};
                if (!args.sMsgId) {
                    return;
                }

                if (!args.sType) {
                    args.sType = "question";
                }

                if (!args.sPopId) {
                    args.sPopId = "tboard";
                }

                if (typeof args.aCallBack !== "function") {
                    args.aCallBack = function() {};
                }
                kosha.confirm(_application, args.sType, args.sMsgId, args.arrParam, args.sPopId, args.aCallBack);
            }
        }

        PortalMessage = class {
            #uuidSeq = 1;
            constructor() {            
                this.msgPopEl = {
                    root: null
                    , section: null
                }                
            }

            uuidGen() {
                let time = new Date().getTime();
                let uuid = String(time) + this.#uuidSeq;
                this.#uuidSeq ++;
                return uuid;            
            }

            createMsgEl (uuId, args) {
                
                let popEl = document.createElement("div");
                popEl.classList.add("popup");
                popEl.id = `tboard_${uuId}`;

                let sectionEl = document.createElement("section");
                sectionEl.classList.add("normal");
                sectionEl.tabIndex = "0";
                sectionEl.role = "dialog";
                sectionEl.ariaModal = "true";
                sectionEl.ariaLabelledby = `modal-title-${uuId}`;

                let h2El = document.createElement("h2");
                h2El.classList.add("title");
                h2El.id = `modal-title-${uuId}`;

                let conetentEl = document.createElement("div");
                conetentEl.classList.add("contents");

                let footerEl   = document.createElement("footer");

                //취소
                if (args.isConfirm) {
                    let btnCancel  = document.createElement("button");
                    footerEl.appendChild(btnCancel);
                    btnCancel.dataset.tboardMsgBtnId = `cancel`;
                    btnCancel.textContent = "취소";
                }

                //확인버튼
                let btnConfirm = document.createElement("button");
                btnConfirm.classList.add("submit");
                footerEl.appendChild(btnConfirm);
                btnConfirm.dataset.tboardMsgBtnId = `confirm`;
                btnConfirm.textContent = "확인";
                
                let btnCloseEl = document.createElement("button");
                btnCloseEl.classList.add("close");
                let spanCloseEl = document.createElement("span");
                spanCloseEl.textContent = "닫기";
                btnCloseEl.appendChild(spanCloseEl);
                btnCloseEl.dataset.tboardMsgBtnId = `close`;

                let btnClose2El = document.createElement("button");
                btnClose2El.classList.add("background");
                let spanCloseEl2 = document.createElement("span");
                spanCloseEl2.textContent = "닫기";
                btnClose2El.appendChild(spanCloseEl2);

                popEl.appendChild(sectionEl);
                sectionEl.appendChild(h2El);
                sectionEl.appendChild(conetentEl);
                sectionEl.appendChild(footerEl);
                sectionEl.appendChild(btnCloseEl);
                popEl.appendChild(btnClose2El);

                return popEl;
            }


            tbAlert(_args) {
                let args = _args || {};
                if (!args.sMsgId) {
                    return;
                }

                if (!args.sType) {
                    args.sType = "question";
                }

                if (!args.sPopId) {
                    args.sPopId = "tboard";
                }

                if (typeof args.aCallBack !== "function") {
                    args.aCallBack = function() {};
                }
                
                let uuId  = this.uuidGen();
                let msgEl = this.createMsgEl(uuId, _args);

                //title
                msgEl.querySelector(".title").textContent = _args.title || "안내";

                //contents
                let contents = msgEl.querySelector(".contents");
                let sMsgId = args.sMsgId || "";
                let lines = sMsgId.split("\n");
                lines.forEach(msg => {
                    const div = document.createElement("div");
                    const p = document.createElement("p");
                    p.textContent = msg.trim();
                    div.appendChild(p);
                    contents.appendChild(div);
                });

                let btnClose   = msgEl.querySelector("[data-tboard-msg-btn-id='close']");
                let btnConfirm = msgEl.querySelector("[data-tboard-msg-btn-id='confirm']");

                btnClose.addEventListener("click", function() {
                    if (msgEl) {
                        msgEl.remove();
                    }
                    if (typeof args.aCallBack === "function") {
                        args.aCallBack(args.sPopId);
                    }                    
                });

                btnConfirm.addEventListener("click", function() {
                    if (msgEl) {
                        msgEl.remove();
                    }
                    if (typeof args.aCallBack === "function") {
                        args.aCallBack(args.sPopId);
                    }
                });

                let app = document.querySelector("[id='app']");
                let container = app.querySelector("[id='container']");
                
                if (container) {
                  container.appendChild(msgEl);
                }
                else {
                  app.appendChild(msgEl);
                }

                //
                btnConfirm.focus();
            }
    
            tbConfirm(_args) {
                let args = _args || {};
                args.isConfirm = true;

                if (!args.sMsgId) {
                    return;
                }

                if (!args.sType) {
                    args.sType = "question";
                }

                if (!args.sPopId) {
                    args.sPopId = "tboard";
                }

                if (typeof args.aCallBack !== "function") {
                    args.aCallBack = function() {};
                }
                
                let uuId  = this.uuidGen();
                let msgEl = this.createMsgEl(uuId, _args);

                //title
                msgEl.querySelector(".title").textContent = _args.title || "확인";

                //contents
                let contents = msgEl.querySelector(".contents");
                let sMsgId = args.sMsgId || "";
                let lines = sMsgId.split("\n");
                lines.forEach(msg => {
                    const div = document.createElement("div");
                    const p = document.createElement("p");
                    p.textContent = msg.trim();
                    div.appendChild(p);
                    contents.appendChild(div);
                });

                let btnCancel  = msgEl.querySelector("[data-tboard-msg-btn-id='cancel']");
                let btnClose   = msgEl.querySelector("[data-tboard-msg-btn-id='close']");
                let btnConfirm = msgEl.querySelector("[data-tboard-msg-btn-id='confirm']");

                btnCancel.addEventListener("click", function() {
                    if (msgEl) {
                        msgEl.remove();
                    }
                    if (typeof args.aCallBack === "function") {
                        args.aCallBack(args.sPopId, false);
                    }                    
                });

                btnClose.addEventListener("click", function() {
                    if (msgEl) {
                        msgEl.remove();
                    }
                    if (typeof args.aCallBack === "function") {
                        args.aCallBack(args.sPopId, false);
                    }                    
                });

                btnConfirm.addEventListener("click", function() {
                    if (msgEl) {
                        msgEl.remove();
                    }
                    if (typeof args.aCallBack === "function") {
                        args.aCallBack(args.sPopId, true);
                    }
                });

                let app = document.querySelector("[id='app']");
                let container = app.querySelector("[id='container']");
                if (container) {
                    container.appendChild(msgEl);
                }
                else {
                    app.appendChild(msgEl);
                }
                //
                btnConfirm.focus();
            }
        }
    },
    
    TboardLogin = class {
        constructor(args) {            
            this.systemCd = args.systemCd;
            this.chnlId   = args.chnlId;
        }

        getLoginPageMoveFn() {
            if (this.chnlId === "local") {
                return this.moveLoginPage;
            }
            else if (this.systemCd === "10") {
                return;
            }
            else if (this.systemCd === "20") {
                return this.moveLoginPage;
            }
            else if (this.systemCd === "21") {
                return;
            }
            else if (this.systemCd === "30") {
                return;
            }
            else if (this.systemCd === "31") {
                return;   
            }
            else if (this.systemCd === "50") {
                return;
            }
            else {
                return;
            }
        }

        moveLoginPage() {
            try {
                if (koshaTboard.vue.router) {
                    let routerArgs = {
                        name: "LoginPortal24"
                    };
                    koshaTboard.vue.router.push(routerArgs);

                    sessionStorage.setItem('rdrout', "tboard::" + window.location.pathname);
                }
            }
            catch (error) {
                return;
            }
        }
    },

    PrjtHandler = class {
        constructor(args) {            
            this.systemCd = args.systemCd;
            this.chnlId   = args.chnlId;
            this.tempViewType = "";
        }

        getPreviewUrl = (args) => {
            try {
                
                let devDomain = "https://dev-erp24.kosha.or.kr/preView/";
                let domain = "";
                try {
                    if (window.location.href.indexOf("localhost") > 0) {
                        return devDomain;
                    }
                    domain = window.location.href.match(/https?:\/\/[^/]*or\.kr/)[0];                
                }
                catch(err) {
                    domain = "";
                }
    
                if (args.chnlId === "local") {
                    return devDomain;
                }
                else if (args.nexacro) {
                    return window.UXBooster.av_sSynapViewerUrl;
                }
                else if (args.systemCd === "20") {                
                    return `${domain}/preView/`;
                }
                else if (args.systemCd === "21") {
                    return `${domain}/k2b/preView/`;
                }
                else if (args.systemCd === "30") {
                    return `${domain}/preView/`;
                }
                else if (args.systemCd === "31") {
                    return `${domain}/k2b/preView/`;
                }            
                else if (args.systemCd === "50") {            
                    return `${domain}/preView/`;
                }
                else {
                    return `${domain}/preView/`;
                }
            }
            catch(err) {
                return "";
            }
        }

        setPrjtTitle(args) {
            const viewType      = args.viewType || "";
            const originTitle   = args.originTitle || "";
            const isWriteOrEdit = args.isWriteOrEdit;
            const subType       = args.subType || "";

            let changeTitle = "";
            let prjtNm = "";
            let addTitle = "";

            try {

                if (!originTitle) return;
                if (["50", "51", "20"].includes( this.systemCd )=== false) return;
                
                if (["list.type1", "list.type2", "list.type3"].includes( viewType )) {
                    addTitle = ""
                }
                else if (["detailType1", "detailType2", "replyType1"].includes( viewType )) {
                    addTitle = "상세페이지";
                    if (this.systemCd === "51") {
                        addTitle = "Detail Page";
                    }
                }
                else if (["replyType1"].includes( viewType )) {
                    addTitle = "답변 상세페이지";
                    if (this.systemCd === "51") {
                        addTitle = "Detail Page";
                    }
                }
                else if (["writeType1"].includes( viewType )) {
                    addTitle = (isWriteOrEdit ? "등록" : "수정") + "페이지";
                    if (this.systemCd === "51") {
                        addTitle = "Detail Page";
                    }
                }
                else if (["writeType1.reply"].includes( viewType )) {
                    addTitle = (isWriteOrEdit ? "등록" : "수정") + "페이지";
                    if (this.systemCd === "51") {
                        addTitle = (isWriteOrEdit ? "Registration" : "Modify") + "Page";
                    }
                }
                else if (["savedView"].includes( viewType )) {
                    addTitle = (subType === "detail" ? "상세페이지" : "");
                    if (this.systemCd === "51") {
                        addTitle = (subType === "detail" ? "Detail Page" : "");
                    }
                }
                else {
                    return;
                }

                this.tempViewType = viewType;
                this.tempTboardId = document.querySelector(`[data-tboard-id]`).dataset.tboardId;

                if (addTitle) {
                    let titleArr = null;
                    if (originTitle.indexOf("|") > -1) {
                        titleArr = originTitle.split("|")[0].split(">");
                        prjtNm  = originTitle.split("|")[1];
                    }
                    else {
                        titleArr = originTitle.split(">");                    
                    }

                    titleArr.push(` ${titleArr[titleArr.length - 1]} ${addTitle}`);
                    //titleArr[titleArr.length - 1] = titleArr[titleArr.length - 1] + (addTitle ? `> ${addTitle}` : "");
                    changeTitle = titleArr.join(">") + (prjtNm ? " |" + prjtNm : "");
                }
                else {
                    changeTitle = originTitle;    
                }
            }
            catch(err) {
                changeTitle = originTitle;
            }

            let cnt = 0;
            let changeTitleFn = setInterval(() => {
                let currentTboardId = "";
                if (document.querySelector(`[data-tboard-id]`)) {
                    currentTboardId = document.querySelector(`[data-tboard-id]`).dataset.tboardId;
                }
                //console.log(document.title);
                cnt++;
                if (cnt > 10 || viewType !== this.tempViewType || currentTboardId !== this.tempTboardId) {
                    clearInterval(changeTitleFn);
                    return;
                }

                cnt = cnt + 1
                document.title = changeTitle;
            }, 500);
        }
    };

    (() => {
        window.tboardInterface.TboardProgress = TboardProgress;
        window.tboardInterface.TboardMessage = TboardMessage;
        window.tboardInterface.TboardLogin = TboardLogin;
        window.tboardInterface.PrjtHandler = PrjtHandler;
    })();
    
}())




