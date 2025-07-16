// SmaregiData 서비스 - 효율적인 데이터 관리
const SmaregiDataService = {
  // 캐시 설정
  CACHE_DURATION: 3600, // 1시간
  BATCH_SIZE: 50,      // 배치 크기
  
  // 필요한 상품 ID만 가져오기
  getSmaregiDataByIds(productIds) {
    try {
      if (!productIds || productIds.length === 0) {
        return {};
      }
      
      const cache = CacheService.getScriptCache();
      const result = {};
      const notInCache = [];
      
      // 1. 캐시에서 먼저 조회
      productIds.forEach(id => {
        const cached = cache.get(`smaregi_${id}`);
        if (cached) {
          result[id] = JSON.parse(cached);
        } else {
          notInCache.push(id);
        }
      });
      
      // 2. 캐시에 없는 것만 시트에서 조회
      if (notInCache.length > 0) {
        const sheetData = this.getFromSheet(notInCache);
        Object.entries(sheetData).forEach(([id, data]) => {
          result[id] = data;
          // 캐시에 저장
          cache.put(`smaregi_${id}`, JSON.stringify(data), this.CACHE_DURATION);
        });
      }
      
      console.log(`SmaregiData 조회: 요청 ${productIds.length}개, 캐시 ${productIds.length - notInCache.length}개`);
      return result;
      
    } catch (error) {
      console.error('getSmaregiDataByIds 오류:', error);
      return {};
    }
  },
  
  // 시트에서 특정 상품들만 조회
  getFromSheet(productIds) {
    const ss = SpreadsheetApp.openById('1fhU41XoZQyu0QlVgwQe3zIbWg-CdULl7UMNeLYQLS5E');
    const sheet = ss.getSheetByName('SmaregiData');
    
    if (!sheet) return {};
    
    const data = sheet.getDataRange().getValues();
    const result = {};
    
    // Set으로 빠른 조회
    const idSet = new Set(productIds.map(id => String(id)));
    
    for (let i = 1; i < data.length; i++) {
      const barcode = String(data[i][0]);
      if (idSet.has(barcode)) {
        result[barcode] = {
          stock: parseInt(data[i][2]) || 0,
          sales30: parseInt(data[i][3]) || 0,
          sales365: parseInt(data[i][4]) || 0,
          avgDaily: parseFloat(data[i][5]) || 0,
          lastSale: String(data[i][8] || '')
        };
      }
    }
    
    return result;
  },
  
  // 인기 상품 목록 (캐시됨)
  getTopProducts(limit = 100) {
    const cache = CacheService.getScriptCache();
    const cacheKey = `top_products_${limit}_v2`; // 캐시 키 버전 추가
    
    // 캐시 확인
    const cached = cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // 캐시 없으면 계산
    const ss = SpreadsheetApp.openById('1fhU41XoZQyu0QlVgwQe3zIbWg-CdULl7UMNeLYQLS5E');
    const sheet = ss.getSheetByName('SmaregiData');
    
    if (!sheet) return [];
    
    const data = sheet.getDataRange().getValues();
    const products = [];
    
    // 모든 상품 수집 (재고가 있거나 판매 이력이 있는 상품)
    for (let i = 1; i < data.length; i++) {
      const sales30 = parseInt(data[i][3]) || 0;
      const stock = parseInt(data[i][2]) || 0;
      const sales365 = parseInt(data[i][4]) || 0;
      
      // 재고가 있거나 1년 내 판매 이력이 있는 상품만 포함
      if (stock > 0 || sales365 > 0) {
        products.push({
          productId: String(data[i][0]),
          productName: data[i][1],
          stock: stock,
          sales30: sales30,
          sales365: sales365,
          avgDaily: parseFloat(data[i][5]) || 0
        });
      }
    }
    
    // 판매량 순으로 정렬
    products.sort((a, b) => b.sales30 - a.sales30);
    const topProducts = products.slice(0, limit);
    
    // 캐시 저장
    cache.put(cacheKey, JSON.stringify(topProducts), this.CACHE_DURATION);
    
    return topProducts;
  },
  
  // 캐시 초기화
  clearCache() {
    const cache = CacheService.getScriptCache();
    // 모든 캐시 키 삭제 (버전 포함)
    cache.remove('top_products_100');
    cache.remove('top_products_600');
    cache.remove('top_products_1000');
    cache.remove('top_products_100_v2');
    cache.remove('top_products_600_v2');
    cache.remove('top_products_1000_v2');
    console.log('SmaregiData 캐시 초기화됨');
  }
};

// 웹앱용 함수들
function getSmaregiDataBatch(productIds) {
  return SmaregiDataService.getSmaregiDataByIds(productIds);
}

function getTopSmaregiProducts(limit) {
  return SmaregiDataService.getTopProducts(limit || 100);
}

function clearSmaregiCache() {
  SmaregiDataService.clearCache();
  return { success: true };
}
