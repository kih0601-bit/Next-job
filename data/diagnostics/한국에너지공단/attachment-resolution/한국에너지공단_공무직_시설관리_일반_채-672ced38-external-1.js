/* Coa 파일 다운로드 컴포넌트 초기화 (길어서 따로 분리)*/
function Coa_InitCustom(area_id, folder_nm, file_type, callback_fn, colum_nm) {
	
	Coa.Init({
		"error": function (res) {
			console.log(res);
		},
		"complete": function (res) {
			for (var i = 0, j = res.length; i < j; i++) {
				var data = $.parseJSON(res[i]);
				
				$("#frm").append("<input type='hidden' name='file_path' value='" + data.FILE_PATH + "' />");
				$("#frm").append("<input type='hidden' name='file_type' value='" + data.FILE_TYPE + "' />");
				$("#frm").append("<input type='hidden' name='origin_nm' value='" + data.ORIGIN_NM + "' />");
				$("#frm").append("<input type='hidden' name='uuid_nm' value='" + data.UUID_NM + "' />");
				$("#frm").append("<input type='hidden' name='file_size' value='" + data.FILE_SIZE + "' />");
			}
			if ( callback_fn instanceof Function ) {
				$("#columNm").val(colum_nm);
				callback_fn();
			}
		},
		"data": {
			"folder_nm" : folder_nm,
			"file_type" : file_type
		},
		"area_id": area_id,
		"upload_url": G_Util.getContextPath()+"/commonFile/fileUpload.do",
		"item_size": 2000000000,
		"is_upload_btn": false,
		"is_delete_btn": true ,
		"permit_ext": [ "zip" , "pdf" , "jpg" , "png" , "bmp" , "hwp" , "doc" , "docx" , "xls" , "xlsx" , "ppt" , "pptx" , "egg",  "mp4", "mp3" , "hwpx" , "ai"] ,
		"no_permit_ext": [ "exe" , "dll" , "bat" , "java" , "jsp" , "html" , "htm" , "asp" , "cs" , "css" , "js" , "aspx" , "ascx" , "php" , "sql" ]
	});
	
}

/* 파일 다운로드 */
function fileDownload(fileNo, fileSeq, boardMngNo) {
	
	$("form#filedownloadForm").remove();
	
	//[1]Validate
	if( G_IsEmpty(fileNo) || G_IsEmpty(fileSeq) ){
		alert("파일 다운로드에 실패하였습니다.");
		return false;
	}
	
	//[2]다운로드를 위한 가상폼 생성
	var oFileForm = $("<form/>",{
		id     : "filedownloadForm",
		name   : "filedownloadForm",
		target : "_self",
		method : "POST",
		action : G_Util.getContextPath()+"/commonFile/fileDownload.do"
	});
	oFileForm.append("<input type='hidden' id='fileNo' name='fileNo' value='" + fileNo + "'/>");
	oFileForm.append("<input type='hidden' id='fileSeq' name='fileSeq' value='" + fileSeq + "'/>");
	oFileForm.append("<input type='hidden' id='boardMngNo' name='boardMngNo' value='" + boardMngNo + "'/>");
	$("body").append(oFileForm);
	oFileForm.submit();
	
}

/* 논리적 파일 삭제 */
function fileDeleteLogi(obj, fileNo, fileSeq) {
	
	var rmvObj = $(obj).closest("tr");
	var fileBody = $(obj).closest("tbody");
	
	//[1]Validate
	if( G_IsEmpty(fileNo) || G_IsEmpty(fileSeq) ){
		alert("파일 삭제에 실패하였습니다.");
		return false;
	}
	//[2]파일삭제 ajax
	if ( confirm("파일을 삭제하시겠습니까?") ) {
		$.ajax({
		    url         : G_Util.getContextPath()+"/commonFile/fileLogicalDelete.do",
		    type        : "POST",
		    dataType    : "json",
		    traditional : true,
		    data        : {
		    	"fileNo" : fileNo,
		    	"fileSeq": fileSeq
		    },
		    error       : function(e){
		    	//console.log(e);
		        alert("파일 삭제에 실패하였습니다."+e.status);
		        return false;
		    },
		    success     : function(result){
		    	if ( result ) {
		    		rmvObj.remove();
		    		if ( fileBody.children().length == 0 ) {
		    			fileBody.html("<tr><th class='center' colspan='2'>등록된 파일이 없습니다.</th></tr>");
		    		}
		    	} else {
		    		console.log (result);
		    		alert("파일 삭제에 실패하였습니다.");
		    	}
		    }
		});
	}
	
}

/* 물리적 파일 삭제 */
function fileDeletePhysi(obj, fileNo, fileSeq) {
	
	var rmvObj = $(obj).closest("tr");
	var fileBody = $(obj).closest("tbody");
	
	//[1]Validate
	if( G_IsEmpty(fileNo) || G_IsEmpty(fileSeq) ){
		alert("파일 삭제에 실패하였습니다.");
		return false;
	}
	//[2]파일삭제 ajax
	if ( confirm("파일을 삭제하시겠습니까?") ) {
		$.ajax({
		    url         : G_Util.getContextPath()+"/commonFile/filePhysicalDelete.do",
		    type        : "POST",
		    dataType    : "json",
		    traditional : true,
		    data        : {
		    	"fileNo" : fileNo,
		    	"fileSeq": fileSeq
		    },
		    error       : function(e){
		    	//console.log(e);
		        alert("파일 삭제에 실패하였습니다."+e.status);
		        return false;
		    },
		    success     : function(result){
		    	if ( result ) {
		    		rmvObj.remove();
		    		if ( fileBody.children().length == 0 ) {
		    			fileBody.html("<tr><th class='center' colspan='2'>등록된 파일이 없습니다.</th></tr>");
		    		}
		    	} else {
		    		console.log (result);
		    		alert("파일 삭제에 실패하였습니다.");
		    	}
		    }
		});
	}
	
}

/* 링크파일 다운로드 */
function LinkFileDownload_origin(fileLinkNo, fileLinkSeq, originNm) {

	$("#formlinkFiledownloadForm").remove();
	console.log (fileLinkNo);
	console.log (fileLinkSeq);
	console.log (originNm);
	console.log("링크파일다운 함수 호출됨 - CtitFile-custom.js")
	//[1]Validate
	if( G_IsEmpty(fileLinkNo) || G_IsEmpty(fileLinkSeq) || G_IsEmpty(originNm) ){
		alert("링크파일 다운로드에 실패하였습니다.");
		return false;
	}

	//[2]다운로드를 위한 가상폼 생성
	var oFileForm = $("<form/>",{
		id     : "linkFiledownloadForm",
		name   : "linkFiledownloadForm",
		target : "_self",
		method : "POST",
		action : G_Util.getContextPath()+"/commonFile/LinkFileDownload.do"
	});
	oFileForm.append("<input type='hidden' id='fileLinkNo' name='fileLinkNo' value='" + fileLinkNo + "'/>");
	oFileForm.append("<input type='hidden' id='fileLinkSeq' name='fileLinkSeq' value='" + fileLinkSeq + "'/>");
	oFileForm.append("<input type='hidden' id='originNm' name='originNm' value='" + originNm + "'/>");
	$("body").append(oFileForm);
	oFileForm.submit();

}
/*링크파일 변형*/
function LinkFileDownload(originNm,filePath) {

	$("#formlinkFiledownloadForm").remove();
	console.log (originNm);
	console.log("링크파일다운 함수 호출됨 - CtitFile-custom.js")
	//[1]Validate
	if( G_IsEmpty(originNm) ){
		alert("링크파일 다운로드에 실패하였습니다.");
		return false;
	}

	//[2]다운로드를 위한 가상폼 생성
	var oFileForm = $("<form/>",{
		id     : "linkFiledownloadForm",
		name   : "linkFiledownloadForm",
		target : "_self",
		method : "POST",
		action : G_Util.getContextPath()+"/commonFile/LinkFileDownload.do"
	});
	oFileForm.append("<input type='hidden' id='originNm' name='originNm' value='" + originNm + "'/>");
	oFileForm.append("<input type='hidden' id='filePath' name='filePath' value='" + filePath + "'/>");
	$("body").append(oFileForm);
	oFileForm.submit();

}