const axios = require('axios');

/**
 * 위도/경도를 지역명으로 변환하는 함수들
 */

// OpenStreetMap Nominatim API 사용 (무료)
const getLocationFromCoordinates = async (latitude, longitude) => {
  try {
    
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        format: 'json',
        lat: latitude,
        lon: longitude,
        addressdetails: 1,
        'accept-language': 'ko'
      },
      headers: {
        'User-Agent': 'CRM-Project/1.0'
      }
    });


    if (response.data && response.data.address) {
      const address = response.data.address;
      
      // 한국 주소 형식으로 변환
      let locationName = '';
      
      // 한국 주소 우선 처리
      if (address.country === '대한민국' || address.country === 'South Korea') {
        if (address.state && address.city) {
          locationName = `${address.state} ${address.city}`;
        } else if (address.state) {
          locationName = address.state;
        } else if (address.city || address.town || address.village) {
          locationName = address.city || address.town || address.village;
        }
      } else {
        // 다른 국가의 경우
        if (address.city || address.town || address.village) {
          locationName = address.city || address.town || address.village;
        } else if (address.state || address.province) {
          locationName = address.state || address.province;
        } else if (address.country) {
          locationName = address.country;
        }
      }
      
      return {
        success: true,
        locationName: locationName || '위치 정보 없음',
        fullAddress: response.data.display_name || '',
        country: address.country || '',
        city: address.city || address.town || address.village || '',
        state: address.state || address.province || ''
      };
    }
    
    return {
      success: false,
      locationName: '위치 정보 없음',
      error: '주소 정보를 찾을 수 없습니다.'
    };
  } catch (error) {
    console.error('지역명 변환 오류:', error.message);
    return {
      success: false,
      locationName: '위치 정보 없음',
      error: error.message
    };
  }
};

// Kakao Maps API 사용 (한국 지역에 특화)
const getLocationFromKakaoAPI = async (latitude, longitude) => {
  try {
    // Kakao API 키가 있다면 사용 (환경변수에서 가져오기)
    const kakaoApiKey = process.env.KAKAO_API_KEY;
    
    if (!kakaoApiKey) {
      return await getLocationFromCoordinates(latitude, longitude);
    }

    const response = await axios.get('https://dapi.kakao.com/v2/local/geo/coord2address.json', {
      params: {
        x: longitude,
        y: latitude
      },
      headers: {
        'Authorization': `KakaoAK ${kakaoApiKey}`
      }
    });

    if (response.data && response.data.documents && response.data.documents.length > 0) {
      const document = response.data.documents[0];
      const address = document.address;
      
      let locationName = '';
      if (address.region_2depth_name) {
        locationName = `${address.region_1depth_name} ${address.region_2depth_name}`;
      } else if (address.region_1depth_name) {
        locationName = address.region_1depth_name;
      }
      
      return {
        success: true,
        locationName: locationName || '위치 정보 없음',
        fullAddress: document.address_name || '',
        country: '대한민국',
        city: address.region_2depth_name || '',
        state: address.region_1depth_name || ''
      };
    }
    
    return {
      success: false,
      locationName: '위치 정보 없음',
      error: '주소 정보를 찾을 수 없습니다.'
    };
  } catch (error) {
    console.error('Kakao 지역명 변환 오류:', error.message);
    // Kakao API 실패 시 OpenStreetMap으로 폴백
    return await getLocationFromCoordinates(latitude, longitude);
  }
};

// 메인 함수 - Kakao API 우선, 실패 시 OpenStreetMap 사용
const convertCoordinatesToLocation = async (latitude, longitude) => {
  try {
    // 먼저 Kakao API 시도
    const kakaoResult = await getLocationFromKakaoAPI(latitude, longitude);
    
    if (kakaoResult.success) {
      return kakaoResult;
    }
    
    // Kakao API 실패 시 OpenStreetMap 사용
    return await getLocationFromCoordinates(latitude, longitude);
  } catch (error) {
    console.error('지역명 변환 전체 오류:', error.message);
    return {
      success: false,
      locationName: '위치 정보 없음',
      error: error.message
    };
  }
};

module.exports = {
  convertCoordinatesToLocation,
  getLocationFromCoordinates,
  getLocationFromKakaoAPI
};
