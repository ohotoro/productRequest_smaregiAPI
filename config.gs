
// ===== config.gs - 전역 설정 및 상수 =====

// 기본 설정
const CONFIG = {
    // 스프레드시트 ID
    PRODUCT_SHEET_ID: '1fhU41XoZQyu0QlVgwQe3zIbWg-CdULl7UMNeLYQLS5E',
    ORDER_SHEET_ID: '1eTIFbWZupx4BhX-PUmgXBNCx-l0BEsLG7GinlCGTNSA',

    // 시트 이름
    PRODUCT_SHEET_NAME: '상품목록',
    CATEGORY_SHEET_NAME: 'category',
    SEARCH_INDEX_NAME: '검색인덱스',

    // 검색 및 캐시 설정
    MAX_SEARCH_RESULTS: 100,
    CACHE_DURATION: 3600, // 1시간
    FREQUENT_ITEMS_COUNT: 1000,

    // 발주 설정
    DEFAULT_MONTHLY_BUDGET: 10000000,
    LOW_STOCK_THRESHOLD: 10,

    // Smaregi API 설정 (Phase 2에서 사용 예정)
    SMAREGI: {
        CONTRACT_ID: 'skuv592u8',
        ACCESS_TOKEN: '78a128116eda101dac5eeb3bb0546c28',
        API_BASE_URL: 'https://webapi.smaregi.jp/access/',
        TIMEOUT: 30000
    },

    // Smaregi プラットフォームAPI 설정
    PLATFORM_CONFIG: {
        // 개발환경용 계약ID
        DEV_CONTRACT_ID: 'sb_skx951h6',

        // 본번환경용 계약ID
        PROD_CONTRACT_ID: 'skuv592u8',

        // 開発環境
        DEV_CLIENT_ID: '5436f7f654c4efa5d2a1f56355c5bca1',
        DEV_CLIENT_SECRET: '531546d78dc35216c63531cf66c85f04ecc472f31ef70d3ea85ce7ae3c1c0724',

        // 本番環境
        PROD_CLIENT_ID: 'add65344a30e3d0b0893fe972702a7b4',
        PROD_CLIENT_SECRET: 'e0ba58828a61ec832facf93bb8c6b40d80085c56f6c191b83a496c2cc97b61cd', // ← 설정 완료!

        // 환경 선택 - 본번환경으로 변경!
        USE_PRODUCTION: true, // ← true로 변경!

        // API 엔드포인트
        DEV_TOKEN_URL: 'https://id.smaregi.dev/app/',
        PROD_TOKEN_URL: 'https://id.smaregi.jp/app/',
        DEV_API_BASE_URL: 'https://api.smaregi.dev/',
        PROD_API_BASE_URL: 'https://api.smaregi.jp/',

        // 권한 스코프
        SCOPES: 'pos.stores:read pos.products:read pos.stock:read pos.transactions:read'
    }
};

// 발주서 열 인덱스 정의 (0부터 시작)
const ORDER_COLUMNS = {
    BARCODE: 0,           // A열: 바코드
    PRODUCT_NAME: 1,      // B열: 상품명
    OPTION: 2,            // C열: 옵션
    QUANTITY: 3,          // D열: 발주수량
    UNIT_PRICE: 4,        // E열: 단가
    AMOUNT: 5,            // F열: 금액
    WEIGHT: 6,            // G열: 중량
    PRIORITY: 7,          // H열: 우선순위
    COMMENT: 8,           // I열: 코멘트
    STATUS: 9,            // J열: 상태
    CONFIRM_TIME: 10,     // K열: 확정시간
    STOCK_STATUS: 11,     // L열: 재고가능여부
    SUPPLIER_NAME: 12,    // M열: 공급사
    EXPORT_TIME: 13,      // N열: 내보내기시간
    CSV_CONFIRM: 14,      // O열: CSV확인
    BOX_NUMBERS: 15,      // P열: 박스번호
    EXPORTABLE_QTY: 16    // Q열: 출고가능수량
};

// 상품 마스터 열 인덱스 정의
const PRODUCT_COLUMNS = {
    BARCODE: 0, // A열
    PRODUCT_NAME: 1, // B열
    OPTION: 2, // C열
    WEIGHT: 3, // D열
    SUPPLIER_NAME: 4, // E열
    SUPPLIER_CODE: 5, // F열
    CATEGORY: 6, // G열
    TAGS: 7, // H열
    PURCHASE_PRICE: 8, // I열
    SALE_PRICE: 9, // J열
    NOTES: 10 // K열
};

// 상태 정의
const STOCK_STATUS = {
    AVAILABLE: '가능',
    UNAVAILABLE: '불가',
    UNKNOWN: '미확인',
    CHECKING: '확인중'
};

const ORDER_STATUS = {
    DRAFT: '임시저장',
    PENDING: '대기',
    CONFIRMED: '확정',
    COMPLETED: '완료',
    CANCELLED: '취소'
};

// 기본 발주 제안 수량
const SUGGEST_QUANTITY = {
    STOCK_0: 30, // 재고 0일 때
    STOCK_10: 20, // 재고 10개 미만일 때
    STOCK_20: 10 // 재고 20개 미만일 때
};

// 오류 메시지
const ERROR_MESSAGES = {
    SHEET_NOT_FOUND: '시트를 찾을 수 없습니다.',
    DATA_LOAD_FAILED: '데이터 로드에 실패했습니다.',
    SAVE_FAILED: '저장에 실패했습니다.',
    INVALID_FORMAT: '올바르지 않은 형식입니다.',
    NETWORK_ERROR: '네트워크 오류가 발생했습니다.',
    PERMISSION_DENIED: '권한이 없습니다.',
    SMAREGI_API_ERROR: 'Smaregi API 오류가 발생했습니다.'
};

// 성공 메시지
const SUCCESS_MESSAGES = {
    SAVED: '저장되었습니다.',
    UPDATED: '업데이트되었습니다.',
    DELETED: '삭제되었습니다.',
    UPLOADED: '업로드되었습니다.',
    CONFIRMED: '확정되었습니다.',
    SYNCED: '동기화되었습니다.'
};

// 카테고리 기본값
const DEFAULT_CATEGORIES = {
    'shirt': 'tops',
    't-shirt': 'tops',
    'tee': 'tops',
    'blouse': 'tops',
    'knit': 'tops',
    'sweater': 'tops',
    'pants': 'bottoms',
    'jeans': 'bottoms',
    'skirt': 'bottoms',
    'shorts': 'bottoms',
    'dress': 'onepiece',
    'jumpsuit': 'onepiece',
    'jacket': 'outerwear',
    'coat': 'outerwear',
    'cardigan': 'outerwear',
    'bag': 'accessories',
    'hat': 'accessories',
    'belt': 'accessories',
    'scarf': 'accessories',
    'shoes': 'footwear',
    'sneakers': 'footwear',
    'boots': 'footwear',
    'sandals': 'footwear'
};
