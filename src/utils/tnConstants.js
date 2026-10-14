// Tamil Nadu Districts, Categories, Helplines and Utilities

export const TN_DISTRICTS = [
  'Ariyalur',
  'Chengalpattu',
  'Chennai',
  'Coimbatore',
  'Cuddalore',
  'Dharmapuri',
  'Dindigul',
  'Erode',
  'Kallakurichi',
  'Kancheepuram',
  'Karur',
  'Krishnagiri',
  'Madurai',
  'Mayiladuthurai',
  'Nagapattinam',
  'Kanniyakumari',
  'Namakkal',
  'Perambalur',
  'Pudukkottai',
  'Ramanathapuram',
  'Ranipet',
  'Salem',
  'Sivagangai',
  'Tenkasi',
  'Thanjavur',
  'Theni',
  'Thiruvallur',
  'Thiruvarur',
  'Thoothukudi',
  'Tiruchirappalli',
  'Tirunelveli',
  'Tirupathur',
  'Tiruppur',
  'Tiruvannamalai',
  'Nilgiris',
  'Vellore',
  'Viluppuram',
  'Virudhunagar',
].sort()

// Approximate center lat/lng for manual selection fallback
export const TN_DISTRICT_COORDS = {
  Ariyalur: [11.1401, 79.0786],
  Chengalpattu: [12.6841, 79.9836],
  Chennai: [13.0827, 80.2707],
  Coimbatore: [11.0168, 76.9558],
  Cuddalore: [11.7480, 79.7714],
  Dharmapuri: [12.1277, 78.1579],
  Dindigul: [10.3673, 77.9803],
  Erode: [11.3410, 77.7172],
  Kallakurichi: [11.7375, 78.9634],
  Kancheepuram: [12.8342, 79.7036],
  Karur: [10.9601, 78.0766],
  Krishnagiri: [12.5186, 78.2138],
  Madurai: [9.9252, 78.1198],
  Mayiladuthurai: [11.1018, 79.6522],
  Nagapattinam: [10.7656, 79.8424],
  Kanniyakumari: [8.0883, 77.5385],
  Namakkal: [11.2189, 78.1674],
  Perambalur: [11.2342, 78.8820],
  Pudukkottai: [10.3833, 78.8001],
  Ramanathapuram: [9.3639, 78.8395],
  Ranipet: [12.9272, 79.3330],
  Salem: [11.6643, 78.1460],
  Sivagangai: [9.8433, 78.4809],
  Tenkasi: [8.9594, 77.3152],
  Thanjavur: [10.7870, 79.1378],
  Theni: [10.0104, 77.4768],
  Thiruvallur: [13.1231, 79.9120],
  Thiruvarur: [10.7725, 79.6365],
  Thoothukudi: [8.7642, 78.1348],
  Tiruchirappalli: [10.7905, 78.7047],
  Tirunelveli: [8.7139, 77.7567],
  Tirupathur: [12.4958, 78.5678],
  Tiruppur: [11.1085, 77.3411],
  Tiruvannamalai: [12.2253, 79.0747],
  Nilgiris: [11.4102, 76.6950],
  Vellore: [12.9165, 79.1325],
  Viluppuram: [11.9401, 79.4861],
  Virudhunagar: [9.5680, 77.9624],
}

export const TN_CATEGORIES = [
  'Waterlogging / Flood',
  'Tree fall',
  'Road damaged / blocked',
  'Electric pole / wire down',
  'Landslide (hilly districts)',
  'Medical emergency',
  'Relief / food needed',
  'Animal rescue',
  'Other',
]

// Map category to the backend enum: 'food' | 'medical' | 'shelter' | 'rescue' | 'water'
export function categoryToNeedType(cat) {
  switch (cat) {
    case 'Waterlogging / Flood':
      return 'Water'
    case 'Medical emergency':
      return 'Medical'
    case 'Relief / food needed':
      return 'Food'
    case 'Other':
      return 'Shelter'
    case 'Tree fall':
    case 'Road damaged / blocked':
    case 'Electric pole / wire down':
    case 'Landslide (hilly districts)':
    case 'Animal rescue':
    default:
      return 'Rescue'
  }
}

export const TN_URGENCIES = [
  'Low',
  'Medium',
  'High',
  'Critical / Life-threatening',
]

export const TN_HELPLINES = [
  { number: '1070', label: 'State Emergency' },
  { number: '1077', label: 'District Collectorate' },
  { number: '112',  label: 'National Emergency' },
  { number: '108',  label: 'Ambulance' },
  { number: '101',  label: 'Fire & Rescue' },
  { number: '104',  label: 'Medical Helpline' },
]

// Compress image on client side (max 1024px, JPEG 0.7) for low bandwidth / 2G / 3G
export async function compressImage(file, maxDimension = 1024, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (e) => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        let { width, height } = img
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width)
            width = maxDimension
          } else {
            width = Math.round((width * maxDimension) / height)
            height = maxDimension
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        resolve(dataUrl)
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}
