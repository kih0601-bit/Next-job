(function(){        
    window.StdTboardConfig = function(_instance) {
        _instance.config = {
            systemCd: "50"
            , chnlId: "kosha24"
            , defaultChannel: "web"
            , contextPath: ""
            , sessionInfo: {
                type: "token"
                , procFn : "setToken"
            },
            ajaxUrl: {
                root: "/api/compn24/auth"
                , default: "/stdtboard/process.do"
                , multipart: "/stdtboard/processMultipart.do"
                , filedown: "/stdtboard/fileDownload.do"
                , getImage: "/stdtboard/getImage.do"
                , api: "/stdtboard/api.do"
            }
            , resource: {
                version : "202411201612",
                rootPath : "/stdtboard",
                sitePath : "/portal",
                html: {
                    search : "/html/tboard_list.html"
                    , detail : "/html/tboard_detail.html"
                    , write : "/html/tboard_write.html"
                },
                script: {
                    config: "/js/kosha-tboard-interface.js"
                },
                style: {
                    common : "/css/tboard.css"
                },
                lib: {
                    quill: {
                        version: "202411201612",
                        path: "/js/quill/",
                        script: {
                            quill : "quill.js"
                        },
                        style: {
                            snow : "quill.snow.css",
                            bubble : "quill.bubble.css"
                        }
                    },
                    exif: {
	                    version: "202411201612",
	                    path: "/js/",
	                    script: {
	                        quill : "exif.js"
	                    }
	                }
                }
            }
        };

        typeof global != "undefined" && window.StdTboardConfig && (global.StdTboardConfig = window.StdTboardConfig);
    }

}());