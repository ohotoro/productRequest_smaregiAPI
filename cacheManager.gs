
// ===== 캐시 관리자 cacheManager.gs =====
const CACHE_KEYS = {
  FREQUENT_BARCODES: 'frequentBarcodes',
  CATEGORY_RULES: 'categoryRules',
  PRODUCT_ISSUES: 'productIssues',
  SAFETY_STOCK: 'safetyStockData',
  SAFETY_STOCK_LIST: 'safetyStockData_list',
  STOCK_DATA: 'stockData',
  STOCK_DATA_TIMESTAMP: 'stockDataTimestamp',
  STOCK_CHUNKS: 'stockDataChunks',
  INITIAL_PRODUCTS: 'initialProducts',
  SHARED_RECENT_PRODUCTS: 'sharedRecentProducts',
  USER_RECENT_PRODUCTS: 'userRecentProducts',
  CURRENT_MONTH_PRODUCTS: 'currentMonthProducts',
  SMAREGI_DATA: 'smaregiData',
  SMAREGI_TIMESTAMP: 'smaregiTimestamp',
  DASHBOARD_DATA: 'dashboardData',
  BOX_BARCODES: 'box_barcodes',
  SUPPLIER_MAP: 'supplierMap',
  TOP_PRODUCTS: 'topProducts'
};

const CACHE_DURATION = {
  SHORT: 300,    // 5분
  MEDIUM: 3600,  // 1시간
  LONG: 21600,   // 6시간
  DAY: 86400     // 24시간
};

const CACHE_CONFIG = {
  SALES_DATA: 86400,      // 24시간
  STOCK_DATA: 3600,       // 1시간 (재고는 자주 변함)
  PRODUCT_DATA: 604800,   // 7일 (상품 정보는 거의 안 변함)
  INDIVIDUAL: 86400,      // 24시간
  
  // 인기 상품은 더 자주 갱신
  HOT_PRODUCT_THRESHOLD: 50,  // 30일 판매 50개 이상
  HOT_PRODUCT_CACHE: 21600,   // 6시간
};

// 캐시 저장 (최적화)
function setCache(key, data, duration = CACHE_DURATION.MEDIUM) {
  try {
    const cache = CacheService.getScriptCache();
    const jsonData = JSON.stringify(data);
    
    // 100KB 이상이면 청크로 분할
    if (jsonData.length > 100000) {
      return setCacheInChunks(key, data, duration);
    }
    
    cache.put(key, jsonData, duration);
    return true;
  } catch (error) {
    console.error('캐시 저장 실패:', error);
    return false;
  }
}

// 박스 바코드 캐시 함수
function getCachedBoxBarcodes() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEYS.BOX_BARCODES);
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  const boxBarcodes = getBoxBarcodesFromSheet();
  cache.put(CACHE_KEYS.BOX_BARCODES, JSON.stringify(boxBarcodes), CACHE_DURATION.SHORT);
  
  return boxBarcodes;
}

// 캐시 조회 (청크 지원 추가)
function getCache(key) {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(key);
    
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        
        // 캐시 나이 계산 (timestamp가 있는 경우)
        if (parsed.timestamp) {
          const age = (new Date() - new Date(parsed.timestamp)) / 1000 / 60; // 분
          console.log(`캐시 히트: ${key} (${Math.round(age)}분 경과)`);
        }
        
        return parsed;
      } catch (e) {
        return cached;
      }
    }
    
    return null;
  } catch (error) {
    console.error('캐시 읽기 실패:', error);
    return null;
  }
}

// 대용량 데이터를 청크로 나누어 저장 (최적화)
function setCacheInChunks(key, data, duration = CACHE_DURATION.MEDIUM) {
  try {
    const cache = CacheService.getScriptCache();
    const CHUNK_SIZE = 100; // 한 청크당 아이템 수
    const MAX_CHUNK_KB = 90; // 청크당 최대 크기 (KB)
    
    const isArray = Array.isArray(data);
    const items = isArray ? data : Object.entries(data);
    
    // 적응형 청크 크기 계산
    const chunks = [];
    let currentChunk = [];
    let currentSize = 0;
    
    for (const item of items) {
      const itemSize = JSON.stringify(item).length;
      
      if (currentSize + itemSize > MAX_CHUNK_KB * 1024 || currentChunk.length >= CHUNK_SIZE) {
        chunks.push(currentChunk);
        currentChunk = [item];
        currentSize = itemSize;
      } else {
        currentChunk.push(item);
        currentSize += itemSize;
      }
    }
    
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    
    // 청크 메타데이터 저장
    const metadata = {
      chunkCount: chunks.length,
      isArray: isArray,
      timestamp: new Date().toISOString(),
      totalItems: items.length
    };
    
    cache.put(`${key}_meta`, JSON.stringify(metadata), duration);
    
    // 각 청크 저장
    chunks.forEach((chunk, index) => {
      const dataToSave = isArray ? chunk : Object.fromEntries(chunk);
      cache.put(`${key}_${index}`, JSON.stringify(dataToSave), duration);
    });
    
    return true;
  } catch (error) {
    console.error('청크 캐시 저장 실패:', error);
    return false;
  }
}

// getCacheInChunks 함수 수정
function getCacheInChunks(key) {
  try {
    const cache = CacheService.getScriptCache();
    
    // 메타데이터 확인
    const metaJson = cache.get(`${key}_meta`);
    if (!metaJson) {
      console.log(`청크 메타데이터 없음: ${key}_meta`);
      return getCacheInChunksLegacy(key);
    }
    
    const metadata = JSON.parse(metaJson);
    const { chunkCount, isArray } = metadata;
    console.log(`청크 메타데이터: ${chunkCount}개 청크, isArray: ${isArray}`);
    
    const result = isArray ? [] : {};
    let loadedChunks = 0;
    
    // 모든 청크 로드
    for (let i = 0; i < chunkCount; i++) {
      const chunkKey = `${key}_${i}`;
      const chunkJson = cache.get(chunkKey);
      if (chunkJson) {
        const chunkData = JSON.parse(chunkJson);
        if (isArray) {
          result.push(...chunkData);
        } else {
          Object.assign(result, chunkData);
        }
        loadedChunks++;
      } else {
        console.warn(`청크 누락: ${chunkKey}`);
      }
    }
    
    console.log(`${loadedChunks}/${chunkCount} 청크 로드 완료`);
    return loadedChunks > 0 ? result : null;
    
  } catch (error) {
    console.error('청크 캐시 로드 실패:', error);
    return null;
  }
}

// 레거시 청크 데이터 로드 (하위 호환성)
function getCacheInChunksLegacy(key) {
  const cache = CacheService.getScriptCache();
  const chunkCount = parseInt(cache.get(`${key}_chunks`) || '0');
  
  if (chunkCount === 0) {
    return null;
  }
  
  const isArray = cache.get(`${key}_isArray`) === 'true';
  const result = isArray ? [] : {};
  
  for (let i = 0; i < chunkCount; i++) {
    const chunkJson = cache.get(`${key}_${i}`);
    if (chunkJson) {
      const chunkData = JSON.parse(chunkJson);
      if (isArray) {
        result.push(...chunkData);
      } else {
        Object.assign(result, chunkData);
      }
    }
  }
  
  return result;
}

// 캐시 무효화 (최적화)
function invalidateCache(key) {
  try {
    const cache = CacheService.getScriptCache();
    
    // 메타데이터 확인
    const metaJson = cache.get(`${key}_meta`);
    if (metaJson) {
      const metadata = JSON.parse(metaJson);
      const { chunkCount } = metadata;
      
      // 새로운 방식의 청크 삭제
      for (let i = 0; i < chunkCount; i++) {
        cache.remove(`${key}_${i}`);
      }
      cache.remove(`${key}_meta`);
    } else {
      // 레거시 방식의 청크 삭제
      const chunkCount = parseInt(cache.get(`${key}_chunks`) || '0');
      if (chunkCount > 0) {
        for (let i = 0; i < chunkCount; i++) {
          cache.remove(`${key}_${i}`);
        }
        cache.remove(`${key}_chunks`);
        cache.remove(`${key}_timestamp`);
        cache.remove(`${key}_isArray`);
      }
    }
    
    // 일반 캐시 삭제
    cache.remove(key);
    
    return true;
  } catch (error) {
    console.error('캐시 무효화 실패:', error);
    return false;
  }
}

// 캐시 상태 확인
function getCacheStatus(key) {
  try {
    const cache = CacheService.getScriptCache();
    
    // 일반 캐시 확인
    const data = cache.get(key);
    if (data) {
      return {
        exists: true,
        type: 'normal',
        size: data.length,
        sizeKB: Math.round(data.length / 1024)
      };
    }
    
    // 청크 캐시 확인
    const metaJson = cache.get(`${key}_meta`);
    if (metaJson) {
      const metadata = JSON.parse(metaJson);
      return {
        exists: true,
        type: 'chunked',
        ...metadata
      };
    }
    
    // 레거시 청크 확인
    const chunkCount = parseInt(cache.get(`${key}_chunks`) || '0');
    if (chunkCount > 0) {
      return {
        exists: true,
        type: 'chunked-legacy',
        chunkCount: chunkCount,
        timestamp: cache.get(`${key}_timestamp`)
      };
    }
    
    return {
      exists: false
    };
  } catch (error) {
    console.error('캐시 상태 확인 실패:', error);
    return { exists: false, error: error.toString() };
  }
}

// 모든 캐시 클리어
function clearAllCache() {
  try {
    const cache = CacheService.getScriptCache();
    
    // 각 캐시 키에 대해 안전하게 삭제
    Object.values(CACHE_KEYS).forEach(key => {
      invalidateCache(key);
    });
    
    return true;
  } catch (error) {
    console.error('전체 캐시 클리어 실패:', error);
    return false;
  }
}

// 캐시 사용량 확인
function getCacheUsage() {
  try {
    const usage = {};
    
    Object.entries(CACHE_KEYS).forEach(([name, key]) => {
      const status = getCacheStatus(key);
      if (status.exists) {
        usage[name] = status;
      }
    });
    
    return usage;
  } catch (error) {
    console.error('캐시 사용량 확인 실패:', error);
    return {};
  }
}

/**
 * 캐시를 무시하고 전체 판매 데이터 강제 갱신
 * @returns {Object} 새로운 판매 데이터
 */
function refreshAllSalesData() {
  try {
    console.log('=== 판매 데이터 강제 갱신 시작 ===');
    
    // API 연결 확인
    if (!isSmaregiAvailable()) {
      return {
        success: false,
        data: {},
        message: 'Smaregi API가 연결되지 않았습니다'
      };
    }
    
    // 설정에서 기간 가져오기
    const settings = getSettings();
    const longPeriod = Math.min(parseInt(settings.salesPeriodLong) || 30, 31);
    
    // 기존 캐시 무효화
    const cacheKey = `ALL_SALES_DATA_V2_${longPeriod}`;
    const cache = CacheService.getScriptCache();
    cache.remove(cacheKey);
    
    console.log('기존 캐시 삭제 완료');
    
    // Platform API로 새로운 데이터 조회
    const salesResult = getSimpleSalesDataV2(longPeriod);
    
    if (!salesResult.success) {
      console.error('판매 데이터 조회 실패:', salesResult.error);
      return {
        success: false,
        message: salesResult.message || '판매 데이터 조회 실패',
        data: {},
        timestamp: new Date().toISOString()
      };
    }
    
    // 데이터 형식 변환
    const formattedData = {};
    
    if (salesResult.data && typeof salesResult.data === 'object') {
      Object.keys(salesResult.data).forEach(productCode => {
        const item = salesResult.data[productCode];
        
        // 바코드-제품코드 매핑 확인
        const barcodeMapping = getBarcodeToProductCodeMapping();
        let barcode = productCode;
        
        // 역매핑 찾기
        for (const [bc, pc] of Object.entries(barcodeMapping)) {
          if (pc === productCode) {
            barcode = bc;
            break;
          }
        }
        
        formattedData[barcode] = {
          barcode: barcode,
          productCode: productCode,
          quantity: item.quantity || 0,
          avgDaily: parseFloat(((item.quantity || 0) / longPeriod).toFixed(1)),
          amount: item.amount || 0,
          trend: item.trend || 'stable',
          transactions: item.transactions || 0,
          lastUpdate: new Date().toISOString()
        };
      });
    }
    
    console.log(`${Object.keys(formattedData).length}개 상품의 판매 데이터 갱신 완료`);
    
    // 새 캐시 저장 (24시간)
    const resultData = {
      data: formattedData,
      timestamp: new Date().toISOString()
    };
    
    setCache(cacheKey, resultData, 86400);
    
    // 개별 캐시도 모두 삭제 (다음 조회 시 새로 생성)
    console.log('개별 캐시 정리 중...');
    
    return {
      success: true,
      data: formattedData,
      period: longPeriod,
      timestamp: resultData.timestamp,
      count: Object.keys(formattedData).length,
      refreshed: true
    };
    
  } catch (error) {
    console.error('판매 데이터 갱신 실패:', error);
    return {
      success: false,
      message: '판매 데이터 갱신 중 오류가 발생했습니다',
      error: error.toString(),
      data: {},
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 판매 데이터 캐시 삭제 및 강제 갱신
 * @returns {Object} 새로운 판매 데이터
 */
function forceRefreshSalesData() {
  try {
    console.log('=== 판매 데이터 강제 갱신 시작 ===');
    
    const settings = getSettings();
    const longPeriod = Math.min(parseInt(settings.salesPeriodLong) || 30, 31);
    
    // 캐시 삭제
    const cache = CacheService.getScriptCache();
    const cacheKey = `ALL_SALES_DATA_V2_${longPeriod}`;
    
    try {
      cache.remove(cacheKey);
      console.log('전체 판매 데이터 캐시 삭제 완료');
    } catch (e) {
      console.log('캐시 삭제 중 오류 (무시):', e);
    }
    
    // 개별 캐시도 정리 (선택적)
    // 이 부분은 성능상 생략 가능
    
    // 새로운 데이터 로드
    const result = loadAllProductsSalesData();
    
    if (result.success) {
      console.log(`강제 갱신 완료: ${result.count}개 상품`);
      
      // 갱신 완료 플래그 추가
      result.refreshed = true;
      result.refreshTime = new Date().toISOString();
      result.fromCache = false;
      result.cacheAge = 0;
    }
    
    return result;
    
  } catch (error) {
    console.error('강제 갱신 실패:', error);
    return {
      success: false,
      message: '판매 데이터 갱신 중 오류가 발생했습니다',
      error: error.toString()
    };
  }
}
