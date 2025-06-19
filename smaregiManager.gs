// ===== smaregiManager.gs =====
function uploadSmaregiCSV(csvContent) {
  console.log('=== Smaregi CSV 업로드 시작 ===');
  
  if (!csvContent) {
    return {
      success: false,
      message: 'CSV 내용이 없습니다'
    };
  }
  
  try {
    const lines = csvContent.split('\n');
    const smaregiData = {};
    const lowStockBarcodes = []; // 바코드만 먼저 수집
    let processedCount = 0;
    
    // 설정값 가져오기
    const settings = getSettings();
    const lowStockThreshold = parseInt(settings.suggestStock10) || 10;
    
    // CSV 파싱 (2행부터 시작)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const columns = parseCSVLine(line);
      
      if (columns.length > 8) {
        const barcode = columns[2] ? columns[2].trim() : '';
        const productName = columns[3] ? columns[3].trim() : '';
        const stockStr = columns[8] ? columns[8].trim() : '0';
        
        if (barcode && barcode !== '商品コード' && barcode !== '상품코드') {
          const stock = parseInt(stockStr) || 0;
          smaregiData[barcode] = stock;
          processedCount++;
          
          // 재고 부족 바코드 수집
          if (stock < lowStockThreshold) {
            lowStockBarcodes.push({
              barcode: barcode,
              name: productName,
              stock: stock
            });
          }
        }
      }
    }
    
    console.log(`처리된 항목 수: ${processedCount}`);
    console.log(`재고 부족 항목 수: ${lowStockBarcodes.length}`);
    
    // 재고 부족 상품의 상세 정보 가져오기
    const enrichedLowStockItems = [];

    if (lowStockBarcodes.length > 0) {
      // 1. 자주 발주하는 바코드 목록 가져오기
      const frequentBarcodes = getCachedFrequentBarcodes();
      const frequentSet = new Set(frequentBarcodes);
      
      // 2. 재고 부족 상품을 자주 발주 여부로 분류
      const frequentLowStock = [];
      const normalLowStock = [];
      
      lowStockBarcodes.forEach(item => {
        if (frequentSet.has(item.barcode)) {
          item.isFrequent = true;
          frequentLowStock.push(item);
        } else {
          item.isFrequent = false;
          normalLowStock.push(item);
        }
      });
      
      // 3. 각 그룹을 재고 수량으로 정렬
      frequentLowStock.sort((a, b) => a.stock - b.stock);
      normalLowStock.sort((a, b) => a.stock - b.stock);
      
      // 4. 자주 발주 상품 우선, 상위 100개 선택
      const limitedItems = [
        ...frequentLowStock.slice(0, 80),  // 자주 발주 최대 80개
        ...normalLowStock.slice(0, 20)     // 일반 상품 최대 20개
      ].slice(0, 100);  // 전체 최대 100개
      
      console.log(`재고 부족: 총 ${lowStockBarcodes.length}개 (자주발주 ${frequentLowStock.length}개)`);
      console.log(`표시: 자주발주 ${Math.min(frequentLowStock.length, 80)}개 + 일반 ${Math.min(normalLowStock.length, 20)}개`);
      
      // 5. 바코드 목록으로 상품 정보 일괄 조회
      const barcodeList = limitedItems.map(item => item.barcode);
      const productMap = getProductsByBarcodesForSmaregi(barcodeList);
      
      // 6. 발주 횟수 정보 가져오기 (선택사항)
      const orderCountMap = getOrderCountByBarcodes(barcodeList);
      
      limitedItems.forEach(item => {
        const productInfo = productMap[item.barcode];
        if (productInfo) {
          enrichedLowStockItems.push({
            barcode: item.barcode,
            name: productInfo.name || item.name,
            option: productInfo.option || '',
            supplierName: productInfo.supplierName || '',
            stock: item.stock,
            suggestedOrder: calculateSuggestedQuantity(item.stock, settings),
            isFrequent: item.isFrequent,
            orderCount: orderCountMap[item.barcode] || 0  // 최근 3개월 발주 횟수
          });
        } else {
          enrichedLowStockItems.push({
            barcode: item.barcode,
            name: item.name || '상품명 없음',
            option: '',
            supplierName: '',
            stock: item.stock,
            suggestedOrder: calculateSuggestedQuantity(item.stock, settings),
            isFrequent: item.isFrequent,
            orderCount: 0
          });
        }
      });
      
      // 최종 정렬: 자주발주 우선, 재고 수량 순
      enrichedLowStockItems.sort((a, b) => {
        if (a.isFrequent !== b.isFrequent) {
          return b.isFrequent ? 1 : -1;  // 자주발주 우선
        }
        return a.stock - b.stock;  // 재고 적은 순
      });
    }
    
    // 데이터 저장 (기존 코드 유지)
    const jsonData = JSON.stringify(smaregiData);
    console.log(`저장할 데이터 크기: ${jsonData.length} bytes`);
    
    const scriptProps = PropertiesService.getScriptProperties();
    
    // 기존 청크 삭제
    const oldChunks = scriptProps.getProperty('SMAREGI_CHUNKS');
    if (oldChunks) {
      const oldChunkCount = parseInt(oldChunks);
      for (let i = 0; i < oldChunkCount; i++) {
        scriptProps.deleteProperty(`SMAREGI_DATA_${i}`);
      }
    }
    
    // 데이터 저장
    if (jsonData.length > 500000) {
      const entries = Object.entries(smaregiData);
      const chunkSize = Math.ceil(entries.length / Math.ceil(jsonData.length / 500000));
      const chunks = [];
      
      for (let i = 0; i < entries.length; i += chunkSize) {
        chunks.push(entries.slice(i, i + chunkSize));
      }
      
      chunks.forEach((chunk, index) => {
        scriptProps.setProperty(`SMAREGI_DATA_${index}`, JSON.stringify(Object.fromEntries(chunk)));
      });
      scriptProps.setProperty('SMAREGI_CHUNKS', chunks.length.toString());
    } else {
      scriptProps.setProperty('SMAREGI_DATA', jsonData);
      scriptProps.setProperty('SMAREGI_CHUNKS', '0');
    }
    
    const now = new Date();
    scriptProps.setProperty('SMAREGI_TIMESTAMP', now.toISOString());
    scriptProps.setProperty('lastSmaregiUpload', now.toISOString());
    
    console.log(`재고 부족 상품 ${enrichedLowStockItems.length}개 준비 완료`);
    
    return {
      success: true,
      data: smaregiData,
      count: processedCount,
      lowStockItems: enrichedLowStockItems,
      uploadTime: now.toLocaleString('ko-KR'),
      message: `${processedCount}개 항목 업로드 완료`
    };
    
  } catch (error) {
    console.error('CSV 업로드 실패:', error);
    console.error('에러 스택:', error.stack);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// 바코드별 발주 횟수 조회 함수
function getOrderCountByBarcodes(barcodes) {
  try {
    const orderCount = {};
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheets = ss.getSheets();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    // 바코드 Set으로 변환
    const barcodeSet = new Set(barcodes);
    
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      if (/^\d{6}/.test(sheetName)) {
        const dateStr = sheetName.substring(0, 6);
        const year = 2000 + parseInt(dateStr.substring(0, 2));
        const month = parseInt(dateStr.substring(2, 4)) - 1;
        const day = parseInt(dateStr.substring(4, 6));
        const sheetDate = new Date(year, month, day);
        
        if (sheetDate >= threeMonthsAgo) {
          const data = sheet.getDataRange().getValues();
          
          for (let i = 1; i < data.length; i++) {
            const barcode = String(data[i][0]);
            if (barcodeSet.has(barcode)) {
              orderCount[barcode] = (orderCount[barcode] || 0) + 1;
            }
          }
        }
      }
    });
    
    return orderCount;
    
  } catch (error) {
    console.error('발주 횟수 조회 실패:', error);
    return {};
  }
}

// 상품 정보 일괄 조회 함수 추가
function getProductsByBarcodesForSmaregi(barcodes) {
  try {
    const productMap = {};
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    
    // 바코드를 Set으로 변환하여 빠른 조회
    const barcodeSet = new Set(barcodes);
    
    for (let i = 1; i < data.length; i++) {
      const barcode = String(data[i][0]);
      if (barcodeSet.has(barcode)) {
        productMap[barcode] = {
          barcode: barcode,
          name: data[i][1] || '',
          option: data[i][2] || '',
          weight: data[i][3] || '',
          supplierName: data[i][4] || '',
          purchasePrice: parseFloat(data[i][8]) || 0
        };
        
        // 모든 바코드를 찾았으면 종료
        if (Object.keys(productMap).length === barcodes.length) {
          break;
        }
      }
    }
    
    return productMap;
    
  } catch (error) {
    console.error('상품 정보 일괄 조회 실패:', error);
    return {};
  }
}

function getProductsByBarcodesMap(barcodes) {
  try {
    const productMap = {};
    
    // 먼저 캐시에서 확인
    const cachedProducts = getCache(CACHE_KEYS.INITIAL_PRODUCTS);
    if (cachedProducts && cachedProducts.products) {
      barcodes.forEach(barcode => {
        const product = cachedProducts.products.find(p => p.barcode === barcode);
        if (product) {
          productMap[barcode] = {
            barcode: barcode,
            name: product.name,
            option: product.option,
            supplierName: product.supplierName
          };
        }
      });
    }
    
    // 캐시에서 못 찾은 바코드들만 스프레드시트에서 조회
    const notFoundBarcodes = barcodes.filter(barcode => !productMap[barcode]);
    
    if (notFoundBarcodes.length > 0) {
      const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
      const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
      const data = sheet.getDataRange().getValues();
      
      for (let i = 1; i < data.length; i++) {
        const barcode = String(data[i][0]);
        if (notFoundBarcodes.includes(barcode)) {
          productMap[barcode] = {
            barcode: barcode,
            name: data[i][1] || '',
            option: data[i][2] || '',
            supplierName: data[i][4] || ''
          };
        }
      }
    }
    
    return productMap;
  } catch (error) {
    console.error('상품 정보 일괄 조회 실패:', error);
    return {};
  }
}

// 제안 수량 계산 헬퍼
function calculateSuggestedQuantity(currentStock, settings) {
  if (currentStock === 0) {
    return parseInt(settings.suggestStock0) || 30;
  } else if (currentStock < 10) {
    return parseInt(settings.suggestStock10) || 20;
  } else if (currentStock < 20) {
    return parseInt(settings.suggestStock20) || 10;
  }
  return 0;
}

// 마지막 Smaregi 업로드 정보 조회
function getLastSmaregiUploadInfo() {
  try {
    // 캐시에서 먼저 확인
    const cachedTimestamp = getCache(CACHE_KEYS.SMAREGI_TIMESTAMP);
    const lastUpload = cachedTimestamp || 
                      PropertiesService.getScriptProperties().getProperty('lastSmaregiUpload');
    
    if (lastUpload) {
      const date = new Date(lastUpload);
      const now = new Date();
      const hoursAgo = Math.floor((now - date) / (1000 * 60 * 60));
      
      return {
        date: Utilities.formatDate(date, 'GMT+9', 'yyyy-MM-dd HH:mm'),
        isToday: isSameDay(date, now),
        hoursAgo: hoursAgo,
        isRecent: hoursAgo < 24
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('Smaregi 업로드 정보 조회 실패:', error);
    return null;
  }
}

// Smaregi 데이터 조회
function getSmaregiData() {
  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const uploadTime = scriptProps.getProperty('SMAREGI_TIMESTAMP');
    
    // 청크 데이터 확인
    const chunkCount = parseInt(scriptProps.getProperty('SMAREGI_CHUNKS') || '0');
    
    let smaregiData = {};
    
    if (chunkCount > 0) {
      // 청크로 나뉜 데이터 조합
      for (let i = 0; i < chunkCount; i++) {
        const chunkData = scriptProps.getProperty(`SMAREGI_DATA_${i}`);
        if (chunkData) {
          Object.assign(smaregiData, JSON.parse(chunkData));
        }
      }
    } else {
      // 단일 데이터
      const data = scriptProps.getProperty('SMAREGI_DATA');
      if (data) {
        smaregiData = JSON.parse(data);
      }
    }
    
    console.log(`Smaregi 데이터 로드: ${Object.keys(smaregiData).length}개 항목`);
    
    return {
      data: smaregiData,
      uploadTime: uploadTime ? new Date(uploadTime).toLocaleString('ko-KR') : null
    };
    
  } catch (error) {
    console.error('Smaregi 데이터 조회 실패:', error);
    return {
      data: {},
      uploadTime: null
    };
  }
}

// CSV 라인 파싱 헬퍼 함수
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

// 날짜 비교 헬퍼 함수
function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

// 바코드로 상품 정보 찾기 (캐시 활용)
// 바코드로 상품 정보 찾기 (캐시 활용)
function getProductByBarcode(barcode) {
  try {
    // 초기 상품 데이터에서 먼저 찾기
    const cachedProducts = getCache(CACHE_KEYS.INITIAL_PRODUCTS);
    if (cachedProducts && cachedProducts.products) {
      const product = cachedProducts.products.find(p => p.barcode === barcode);
      if (product) {
        return {
          barcode: barcode,
          name: product.name,
          option: product.option,
          supplierName: product.supplierName
        };
      }
    }
    
    // 캐시에 없으면 null 반환 (스프레드시트 조회 생략)
    return null;
    
  } catch (error) {
    console.error('상품 조회 실패:', error);
    return null;
  }
}

// 특정 바코드의 매장 재고 확인
function getStoreStock(barcode) {
  const smaregiData = getSmaregiData();
  return {
    barcode: barcode,
    storeStock: smaregiData[barcode] || 0,
    hasData: barcode in smaregiData,
    lastUpdate: getLastSmaregiUploadInfo()
  };
}

// 발주 제안 계산
function calculateOrderSuggestion(barcode) {
  const smaregiData = getSmaregiData();
  const currentStock = smaregiData[barcode] || 0;
  const settings = getSettings();
  
  const suggested = calculateSuggestedQuantity(currentStock, settings);
  
  return {
    currentStock: currentStock,
    suggestedOrder: suggested,
    reason: getOrderReason(currentStock)
  };
}

// 발주 이유 설명
function getOrderReason(currentStock) {
  if (currentStock === 0) {
    return '재고 소진';
  } else if (currentStock < 10) {
    return '재고 부족';
  } else if (currentStock < 20) {
    return '재고 여유 확보';
  }
  return '적정 재고';
}

// Smaregi 데이터 초기화
function clearSmaregiData() {
  try {
    invalidateCache(CACHE_KEYS.SMAREGI_DATA);
    invalidateCache(CACHE_KEYS.SMAREGI_TIMESTAMP);
    
    const scriptProps = PropertiesService.getScriptProperties();
    scriptProps.deleteProperty('lastSmaregiUpload');
    
    return { success: true, message: 'Smaregi 데이터가 초기화되었습니다.' };
  } catch (error) {
    console.error('Smaregi 데이터 초기화 실패:', error);
    return { success: false, message: '초기화 실패: ' + error.toString() };
  }
}

// 매장 재고 통계
function getSmaregiStats() {
  try {
    const smaregiData = getSmaregiData();
    const lastUpdate = getLastSmaregiUploadInfo();
    
    if (!smaregiData || Object.keys(smaregiData).length === 0) {
      return null;
    }
    
    const stats = {
      totalItems: 0,
      outOfStock: 0,
      lowStock: 0,    // 10개 미만
      normal: 0,      // 10-50개
      highStock: 0,   // 50개 초과
      lastUpdate: lastUpdate
    };
    
    Object.values(smaregiData).forEach(stock => {
      stats.totalItems++;
      
      if (stock === 0) {
        stats.outOfStock++;
      } else if (stock < 10) {
        stats.lowStock++;
      } else if (stock <= 50) {
        stats.normal++;
      } else {
        stats.highStock++;
      }
    });
    
    return stats;
    
  } catch (error) {
    console.error('Smaregi 통계 생성 실패:', error);
    return null;
  }
}

// 재고 부족 상품 목록
function getLowStockItems(limit = 20) {
  try {
    const smaregiData = getSmaregiData();
    const settings = getSettings();
    const lowStockThreshold = parseInt(settings.suggestStock10) || 10;
    
    const lowStockItems = [];
    
    Object.entries(smaregiData).forEach(([barcode, stock]) => {
      if (stock < lowStockThreshold) {
        const productInfo = getProductByBarcode(barcode);
        if (productInfo) {
          lowStockItems.push({
            ...productInfo,
            currentStock: stock,
            suggestedOrder: calculateSuggestedQuantity(stock, settings)
          });
        }
      }
    });
    
    // 재고 수량 오름차순 정렬
    lowStockItems.sort((a, b) => a.currentStock - b.currentStock);
    
    return lowStockItems.slice(0, limit);
    
  } catch (error) {
    console.error('재고 부족 상품 조회 실패:', error);
    return [];
  }
}