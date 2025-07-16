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
  BOX_BARCODES: 'box_barcodes'
};

const CACHE_DURATION = {
  SHORT: 300,    // 5분
  MEDIUM: 3600,  // 1시간
  LONG: 21600,   // 6시간
  DAY: 86400     // 24시간
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
    
    // 먼저 일반 캐시 확인
    const data = cache.get(key);
    if (data) {
      return JSON.parse(data);
    }
    
    // 청크 데이터 확인
    const chunkCount = parseInt(cache.get(`${key}_chunks`) || '0');
    if (chunkCount > 0) {
      return getCacheInChunks(key);
    }
    
    return null;
  } catch (error) {
    console.error('캐시 조회 실패:', error);
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

function getInitialDataBundle() {
  try {
    console.log('데이터 번들 로드 시작');
    const startTime = new Date();
    
    // 캐시 확인
    const cache = CacheService.getScriptCache();
    const cached = cache.get('INITIAL_BUNDLE_V1');
    
    if (cached) {
      const data = JSON.parse(cached);
      const age = (new Date() - new Date(data.timestamp)) / 1000 / 60;
      if (age < 30) {
        console.log('번들 캐시 사용');
        return data;
      }
    }
    
    // 모든 초기 데이터를 한 번에 수집
    const bundle = {
      // 상품 데이터
      productsData: loadInitialProductsWithIssues(),
      
      // 설정
      settings: getSettings(),
      
      // 현재 발주서
      currentOrder: getCurrentOrder(),
      
      // Smaregi 데이터
      smaregiData: {
        data: getSmaregiData() || {},
        uploadTime: PropertiesService.getScriptProperties().getProperty('smaregiUploadTime')
      },
      
      // 카테고리 규칙
      categoryRules: loadCategoryRules(),
      
      // 타임스탬프
      timestamp: new Date().toISOString(),
      
      // 로드 시간
      loadTime: new Date() - startTime
    };
    
    // 캐시 저장
    cache.put('INITIAL_BUNDLE_V1', JSON.stringify(bundle), 1800); // 30분
    
    console.log(`번들 생성 완료: ${bundle.loadTime}ms`);
    return bundle;
    
  } catch (error) {
    console.error('데이터 번들 생성 실패:', error);
    // 실패 시 개별 로드로 폴백
    return null;
  }
}
