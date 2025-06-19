// ===== languages.gs - 다국어 지원 =====
const LANGUAGES = {
  ko: {
    // 공통
    common: {
      search: '검색',
      add: '추가',
      save: '저장',
      cancel: '취소',
      delete: '삭제',
      edit: '수정',
      close: '닫기',
      confirm: '확인',
      reset: '초기화',
      loading: '로딩 중...',
      noData: '데이터가 없습니다',
      error: '오류',
      success: '성공',
      warning: '경고',
      info: '정보'
    },
    
    // 헤더 & 네비게이션
    header: {
      title: 'OHOTORO 발주관리',
      orderTab: '발주서 작성',
      dashboardTab: '대시보드',
      frequentTab: '자주 발주',
      safetyStockTab: '안전재고',
      settingsTab: '설정'
    },
    
    // 발주서 관련
    order: {
      createOrder: '새 발주서 생성',
      openOrder: '기존 발주서 열기',
      selectRecipient: '발주처를 선택하세요',
      newRecipient: '새 발주처명',
      orderList: '발주 목록',
      totalItems: '총 상품수',
      totalQuantity: '총 수량',
      totalAmount: '예상 금액',
      pendingItems: '미확정',
      confirmSelected: '선택 확정',
      confirmAll: '전체 확정',
      saveDraft: '임시 저장',
      exportCSV: 'CSV 내보내기',
      stockUpload: '재고 업로드',
      mergeItems: '동일상품 합치기',
      noOrderMessage: '발주서를 먼저 생성해주세요',
      searchPlaceholder: '상품명 또는 바코드로 검색...',
      quantity: '수량',
      priority: '우선순위',
      comment: '코멘트',
      status: '상태',
      confirmed: '확정',
      pending: '대기'
    },
    
    // 상품 정보
    product: {
      productName: '상품명',
      barcode: '바코드',
      option: '옵션',
      supplier: '공급사',
      price: '가격',
      weight: '중량',
      memo: '메모',
      remarks: '비고'
    },
    
    // 재고 상태
    stock: {
      available: '가능',
      soldOut: '품절',
      ordering: '오더중',
      checking: '확인중',
      unconfirmed: '미확인',
      customInput: '직접입력',
      stockStatus: '재고 상태',
      changeStockStatus: '재고 상태 변경',
      onlyAvailable: '개만 가능',
      uploadCSV: '재고 CSV 업로드',
      updateTarget: '재고 업데이트 대상',
      confirmedOnly: '확정 상품만',
      unconfirmedOnly: '미확정 상품만',
      allItems: '전체 상품'
    },
    
    // 안전재고
    safetyStock: {
      title: '안전재고 관리',
      description: '재고 부족을 예방하기 위한 최소 보유 수량을 설정합니다',
      addSafetyStock: '안전재고 추가',
      searchPlaceholder: '바코드, 상품명, 옵션으로 검색...',
      type: '안전재고 타입',
      typeQuantity: '수량',
      typePercentage: '퍼센트 (%)',
      value: '안전재고 값',
      noSafetyStock: '안전재고가 설정되지 않았습니다',
      firstSafetyStock: '첫 안전재고 추가하기'
    },
    
    // 대시보드
    dashboard: {
      monthlyAmount: '이번 달 발주액',
      avgCycle: '평균 발주 주기',
      repeatRate: '반복 발주율',
      budgetUsage: '예산 사용률',
      topProducts: '발주 베스트 TOP 10',
      categoryStats: '카테고리별 발주 현황',
      monthlyTrend: '월별 발주 금액 추이',
      supplierStats: '공급사별 발주 현황 TOP 10',
      weekdayPattern: '요일별 발주 패턴',
      budgetStatus: '월 예산 사용 현황',
      trendingUp: '급상승',
      trendingDown: '급하락'
    },
    
    // 자주 발주
    frequent: {
      title: '자주 발주하는 상품',
      subtitle: '최근 3개월 발주 횟수 기준',
      refresh: '새로고침',
      totalCount: '전체',
      needOrder: '발주 필요',
      thisMonth: '이번달 발주',
      orderCount: '발주',
      avgQuantity: '평균',
      cycle: '주기',
      lastOrder: '일 전',
      addToOrder: '발주 추가'
    },
    
    // 설정
    settings: {
      title: '시스템 설정',
      productSheetId: '상품 데이터 시트 ID',
      orderSheetId: '발주서 저장 시트 ID',
      maxResults: '검색 결과 최대 표시 개수',
      monthlyBudget: '월 예산 설정',
      language: '언어 설정',
      displayOptions: '표시 옵션',
      colorChip: '컬러칩 표시',
      colorChipDesc: '색상 정보를 시각적인 컬러칩으로 표시합니다',
      showBarcode: '바코드 표시',
      showSupplier: '공급사명 표시',
      compactMode: '컴팩트 모드',
      compactModeDesc: '더 많은 항목을 한 화면에 표시합니다',
      importData: '과거 발주 데이터 가져오기',
      importPlaceholder: '과거 발주 스프레드시트 URL 입력',
      importBtn: '데이터 가져오기',
      saveSettings: '설정 저장'
    },
    
    // 메시지
    messages: {
      searchFirst: '검색어를 입력해주세요.',
      createOrderFirst: '먼저 발주서를 생성해주세요.',
      noItemsToSave: '저장할 항목이 없습니다.',
      selectItemsFirst: '확정할 항목을 선택해주세요.',
      confirmAllItems: '개 항목을 모두 확정하시겠습니까?',
      confirmDelete: '정말 삭제하시겠습니까?',
      confirmClear: '정말 초기화 하시겠습니까?',
      savedSuccess: '저장되었습니다.',
      addedSuccess: '추가되었습니다.',
      deletedSuccess: '삭제되었습니다.',
      settingsSaved: '설정이 저장되었습니다.',
      loadError: '데이터 로드 실패',
      saveError: '저장 실패',
      networkError: '네트워크 오류',
      confirmReorder: '이미 발주목록에서 확정된 상품입니다. 추가로 발주하시겠습니까?',
      quantityIncreased: '수량이 증가되었습니다.',
      itemsRestored: '이전 작업이 복원되었습니다.',
      csvExported: 'CSV 파일이 다운로드되었습니다.',
      stockUpdated: '재고 정보가 업데이트되었습니다.'
    }
  },
  
  ja: {
    // 共通
    common: {
      search: '検索',
      add: '追加',
      save: '保存',
      cancel: 'キャンセル',
      delete: '削除',
      edit: '編集',
      close: '閉じる',
      confirm: '確認',
      reset: '初期化',
      loading: '読み込み中...',
      noData: 'データがありません',
      error: 'エラー',
      success: '成功',
      warning: '警告',
      info: '情報'
    },
    
    // ヘッダー & ナビゲーション
    header: {
      title: 'OHOTORO 発注管理',
      orderTab: '発注書作成',
      dashboardTab: 'ダッシュボード',
      frequentTab: 'よく発注',
      safetyStockTab: '安全在庫',
      settingsTab: '設定'
    },
    
    // 発注書関連
    order: {
      createOrder: '新規発注書作成',
      openOrder: '既存発注書を開く',
      selectRecipient: '発注先を選択してください',
      newRecipient: '新規発注先名',
      orderList: '発注リスト',
      totalItems: '商品総数',
      totalQuantity: '総数量',
      totalAmount: '予想金額',
      pendingItems: '未確定',
      confirmSelected: '選択確定',
      confirmAll: '全体確定',
      saveDraft: '一時保存',
      exportCSV: 'CSV出力',
      stockUpload: '在庫アップロード',
      mergeItems: '同一商品をまとめる',
      noOrderMessage: '先に発注書を作成してください',
      searchPlaceholder: '商品名またはバーコードで検索...',
      quantity: '数量',
      priority: '優先順位',
      comment: 'コメント',
      status: 'ステータス',
      confirmed: '確定',
      pending: '待機'
    },
    
    // 商品情報
    product: {
      productName: '商品名',
      barcode: 'バーコード',
      option: 'オプション',
      supplier: '仕入先',
      price: '価格',
      weight: '重量',
      memo: 'メモ',
      remarks: '備考'
    },
    
    // 在庫状態
    stock: {
      available: '可能',
      soldOut: '品切れ',
      ordering: 'オーダー中',
      checking: '確認中',
      unconfirmed: '未確認',
      customInput: '直接入力',
      stockStatus: '在庫状態',
      changeStockStatus: '在庫状態変更',
      onlyAvailable: '個のみ可能',
      uploadCSV: '在庫CSVアップロード',
      updateTarget: '在庫更新対象',
      confirmedOnly: '確定商品のみ',
      unconfirmedOnly: '未確定商品のみ',
      allItems: '全商品'
    },
    
    // 安全在庫
    safetyStock: {
      title: '安全在庫管理',
      description: '在庫不足を防ぐための最小保有数量を設定します',
      addSafetyStock: '安全在庫追加',
      searchPlaceholder: 'バーコード、商品名、オプションで検索...',
      type: '安全在庫タイプ',
      typeQuantity: '数量',
      typePercentage: 'パーセント (%)',
      value: '安全在庫値',
      noSafetyStock: '安全在庫が設定されていません',
      firstSafetyStock: '最初の安全在庫を追加'
    },
    
    // ダッシュボード
    dashboard: {
      monthlyAmount: '今月の発注額',
      avgCycle: '平均発注周期',
      repeatRate: '繰り返し発注率',
      budgetUsage: '予算使用率',
      topProducts: '発注ベストTOP 10',
      categoryStats: 'カテゴリ別発注状況',
      monthlyTrend: '月別発注金額推移',
      supplierStats: '仕入先別発注状況TOP 10',
      weekdayPattern: '曜日別発注パターン',
      budgetStatus: '月予算使用状況',
      trendingUp: '急上昇',
      trendingDown: '急下降'
    },
    
    // よく発注
    frequent: {
      title: 'よく発注する商品',
      subtitle: '直近3ヶ月の発注回数基準',
      refresh: '更新',
      totalCount: '全体',
      needOrder: '発注必要',
      thisMonth: '今月発注',
      orderCount: '発注',
      avgQuantity: '平均',
      cycle: '周期',
      lastOrder: '日前',
      addToOrder: '発注追加'
    },
    
    // 設定
    settings: {
      title: 'システム設定',
      productSheetId: '商品データシートID',
      orderSheetId: '発注書保存シートID',
      maxResults: '検索結果最大表示数',
      monthlyBudget: '月予算設定',
      language: '言語設定',
      displayOptions: '表示オプション',
      colorChip: 'カラーチップ表示',
      colorChipDesc: '色情報を視覚的なカラーチップで表示します',
      showBarcode: 'バーコード表示',
      showSupplier: '仕入先名表示',
      compactMode: 'コンパクトモード',
      compactModeDesc: 'より多くの項目を一画面に表示します',
      importData: '過去の発注データインポート',
      importPlaceholder: '過去の発注スプレッドシートURL入力',
      importBtn: 'データインポート',
      saveSettings: '設定保存'
    },
    
    // メッセージ
    messages: {
      searchFirst: '検索語を入力してください。',
      createOrderFirst: '先に発注書を作成してください。',
      noItemsToSave: '保存する項目がありません。',
      selectItemsFirst: '確定する項目を選択してください。',
      confirmAllItems: '個の項目をすべて確定しますか？',
      confirmDelete: '本当に削除しますか？',
      confirmClear: '本当に初期化しますか？',
      savedSuccess: '保存されました。',
      addedSuccess: '追加されました。',
      deletedSuccess: '削除されました。',
      settingsSaved: '設定が保存されました。',
      loadError: 'データ読み込み失敗',
      saveError: '保存失敗',
      networkError: 'ネットワークエラー',
      confirmReorder: 'すでに発注リストで確定された商品です。追加で発注しますか？',
      quantityIncreased: '数量が増加されました。',
      itemsRestored: '以前の作業が復元されました。',
      csvExported: 'CSVファイルがダウンロードされました。',
      stockUpdated: '在庫情報が更新されました。'
    }
  }
};

// 현재 언어 가져오기
function getCurrentLanguage() {
  const userProperties = PropertiesService.getUserProperties();
  const savedLang = userProperties.getProperty('language');
  
  if (savedLang && LANGUAGES[savedLang]) {
    return savedLang;
  }
  
  // 브라우저 언어 감지는 클라이언트에서 처리
  return 'ko'; // 기본값
}

// 번역 텍스트 가져오기
function getTranslations(lang) {
  return LANGUAGES[lang] || LANGUAGES['ko'];
}

// 언어 변경 저장
function changeLanguage(newLang) {
  if (!LANGUAGES[newLang]) {
    return { success: false, message: 'Unsupported language' };
  }
  
  const userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty('language', newLang);
  
  return { 
    success: true, 
    translations: LANGUAGES[newLang] 
  };
}