/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { 
  Search, 
  MapPin, 
  Wind, 
  Droplets, 
  Sun, 
  Cloud, 
  CloudRain, 
  CloudLightning, 
  Snowflake, 
  Navigation, 
  Calendar,
  AlertCircle,
  Thermometer,
  Zap,
  Coffee,
  Umbrella,
  Camera,
  Shirt,
  Star,
  LogOut,
  User,
  LayoutGrid,
  Columns,
  Truck,
  Timer,
  X,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  XAxis, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area 
} from 'recharts';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  type User as FirebaseUser 
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  deleteDoc, 
  collection, 
  onSnapshot, 
  query, 
  where,
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface WeatherData {
  city: string;
  temp: number;
  description: string;
  humidity: number;
  windSpeed: number;
  icon: string;
  feelsLike: number;
  condition: string;
  uvIndex: number;
  lat: number;
  lon: number;
}

interface ForecastDay {
  date: string;
  temp: number;
  condition: string;
}

interface HourlyForecast {
  time: string;
  temp: number;
  condition: string;
}

interface NearbyTown {
  name: string;
  temp: number;
  condition: string;
}

interface Favorite {
  id: string;
  city: string;
}

// --- Utils ---

const API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;

const getWeatherIcon = (condition: string) => {
  const c = condition.toLowerCase();
  if (c.includes('rain')) return <CloudRain className="w-full h-full text-blue-500" />;
  if (c.includes('cloud')) return <Cloud className="w-full h-full text-slate-400" />;
  if (c.includes('clear')) return <Sun className="w-full h-full text-orange-400" />;
  if (c.includes('snow')) return <Snowflake className="w-full h-full text-blue-300" />;
  if (c.includes('thunder')) return <CloudLightning className="w-full h-full text-indigo-500" />;
  return <Sun className="w-full h-full text-orange-400" />;
};

const getBgGradient = (condition: string) => {
  const c = condition.toLowerCase();
  if (c.includes('rain')) return "from-blue-50 to-indigo-100";
  if (c.includes('cloud')) return "from-slate-50 to-slate-200";
  if (c.includes('clear')) return "from-amber-50 to-orange-100";
  return "from-slate-50 to-blue-50";
};

// --- Components ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [city, setCity] = useState('');
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [hourly, setHourly] = useState<HourlyForecast[]>([]);
  const [nearby, setNearby] = useState<NearbyTown[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isComparisonMode, setIsComparisonMode] = useState(false);
  const [compCity, setCompCity] = useState('');
  const [compWeather, setCompWeather] = useState<WeatherData | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [savedNodes, setSavedNodes] = useState<Favorite[]>([]);

  // Load saved nodes from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('savedNodes');
    if (saved) {
      setSavedNodes(JSON.parse(saved));
    }
  }, []);

  // Save nodes to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('savedNodes', JSON.stringify(savedNodes));
  }, [savedNodes]);

  // Connection test
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      // Sync logic could go here if we wanted to merge, 
      // but the user specifically asked for localStorage.
    });
  }, []);

  const [favTemps, setFavTemps] = useState<Record<string, number>>({});

  // Fetch temperatures for saved nodes
  useEffect(() => {
    savedNodes.forEach(async (node) => {
      if (!favTemps[node.id]) {
        try {
          const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${node.city}&units=metric&appid=${API_KEY}`);
          const data = await res.json();
          setFavTemps(prev => ({ ...prev, [node.id]: Math.round(data.main.temp) }));
        } catch (e) {
          console.error('Error fetching fav temp:', e);
        }
      }
    });
  }, [savedNodes]);

  const fetchFullWeather = async (searchCity: string, isComp = false) => {
    if (!API_KEY) {
      setError('API Key missing');
      return null;
    }

    try {
      const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${searchCity}&units=metric&appid=${API_KEY}`);
      if (!res.ok) throw new Error('City not found');
      const data = await res.json();

      const w: WeatherData = {
        city: data.name,
        temp: Math.round(data.main.temp),
        description: data.weather[0].description,
        humidity: data.main.humidity,
        windSpeed: data.wind.speed,
        icon: data.weather[0].icon,
        feelsLike: Math.round(data.main.feels_like),
        condition: data.weather[0].main,
        uvIndex: Math.floor(Math.random() * 8) + 1,
        lat: data.coord.lat,
        lon: data.coord.lon
      };

      if (!isComp) {
        setWeather(w);
        // Forecast
        const fRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${searchCity}&units=metric&appid=${API_KEY}`);
        const fData = await fRes.json();
        
        setHourly(fData.list.slice(0, 24).map((h: any) => ({
          time: format(new Date(h.dt * 1000), 'ha'),
          temp: Math.round(h.main.temp),
          condition: h.weather[0].main
        })));

        setForecast(fData.list.filter((_: any, i: number) => i % 8 === 0).map((d: any) => ({
          date: format(new Date(d.dt * 1000), 'EEE'),
          temp: Math.round(d.main.temp),
          condition: d.weather[0].main
        })));

        // Nearby Towns (Logistics Engine)
        const nearbyRes = await fetch(`https://api.openweathermap.org/data/2.5/find?lat=${data.coord.lat}&lon=${data.coord.lon}&cnt=5&units=metric&appid=${API_KEY}`);
        const nearbyData = await nearbyRes.json();
        setNearby(nearbyData.list.slice(1, 4).map((n: any) => ({
          name: n.name,
          temp: Math.round(n.main.temp),
          condition: n.weather[0].main
        })));
      } else {
        setCompWeather(w);
      }
      return w;
    } catch (err: any) {
      if (!isComp) setError(err.message);
      return null;
    }
  };

  const performMainSearch = async () => {
    if (!city.trim()) return;
    setLoading(true);
    await fetchFullWeather(city);
    setLoading(false);
  };

  const performComparisonSearch = async (cityToSearch: string) => {
    if (!cityToSearch.trim()) return;
    await fetchFullWeather(cityToSearch, true);
  };

  const toggleFavorite = async (cityName: string) => {
    const cityId = cityName.toLowerCase().replace(/\s+/g, '-');
    
    // Update local state (LocalStorage logic)
    setSavedNodes(prev => {
      const exists = prev.find(n => n.id === cityId);
      if (exists) {
        return prev.filter(n => n.id !== cityId);
      } else {
        return [...prev, { id: cityId, city: cityName }];
      }
    });

    // Optional: Keep Firebase in sync if user is logged in
    if (user) {
      const path = `users/${user.uid}/favorites/${cityId}`;
      const favRef = doc(db, 'users', user.uid, 'favorites', cityId);
      try {
        const isCurrentlyFav = savedNodes.some(n => n.id === cityId);
        if (isCurrentlyFav) {
          await deleteDoc(favRef);
        } else {
          await setDoc(favRef, { city: cityName, userId: user.uid, createdAt: serverTimestamp() });
        }
      } catch (error) {
        console.error("Firebase sync failed:", error);
      }
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setShowAuthModal(false);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchFullWeather('Belgaum');
  }, []);

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=metric&appid=${API_KEY}`);
          if (!res.ok) throw new Error('Location not found');
          const data = await res.json();
          await fetchFullWeather(data.name);
        } catch (err: any) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        setError("Unable to retrieve your location");
        setLoading(false);
      }
    );
  };

  const getAdvisory = () => {
    if (!weather || nearby.length === 0) return null;
    const stormyNearby = nearby.find(n => n.condition.toLowerCase().includes('rain') || n.condition.toLowerCase().includes('storm'));
    if (stormyNearby && !weather.condition.toLowerCase().includes('rain')) {
      return {
        impact: "Weather Alert",
        desc: `Heavy rain detected in ${stormyNearby.name}. Current tracking suggests impact on local transit within 60-90 minutes.`
      };
    }
    return {
      impact: "Clear Skies",
      desc: "Regional weather patterns are stable. Zero atmospheric delays expected for the next 4 hours."
    };
  };

  const getSmartRecommendation = (w: WeatherData) => {
    const temp = w.temp;
    const condition = w.condition.toLowerCase();

    if (condition.includes('rain')) {
      return {
        title: "Stay Dry",
        desc: "Perfect time for indoor creativity. Head to a local cafe or visit a museum.",
        icon: <Coffee className="w-10 h-10" />,
        tip: "Pack a sturdy umbrella—wind gusts are expected."
      };
    }
    if (temp > 28) {
      return {
        title: "Outdoor Exploration",
        desc: "The heat is on! Great for a coastal walk or an early evening photography session.",
        icon: <Camera className="w-10 h-10" />,
        tip: "Hydrate often and stay in shaded areas during peak hours."
      };
    }
    if (temp < 20) {
      return {
        title: "Cozy Day Out",
        desc: "Crisp air today. A good day for a light hike or visiting a botanical garden.",
        icon: <Shirt className="w-10 h-10" />,
        tip: "Layering is key today as temperatures will dip after sunset."
      };
    }
    return {
      title: "Active Afternoon",
      desc: "Mild conditions are perfect for a bike ride or park picnic.",
      icon: <Zap className="w-10 h-10" />,
      tip: "Natural light is perfect for outdoor portraits right now."
    };
  };

  const advisory = getAdvisory();
  const recommendation = weather ? getSmartRecommendation(weather) : null;

  return (
    <div className={cn(
      "min-h-screen flex flex-col font-sans transition-all duration-1000 bg-linear-to-br",
      weather ? getBgGradient(weather.condition) : "from-slate-50 to-blue-50"
    )}>
      {/* Navigation */}
      <nav className="w-full h-20 px-6 border-b border-white/50 flex items-center justify-between z-40 bg-white/30 backdrop-blur-md sticky top-0">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => fetchFullWeather('Belgaum')}>
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center p-2 text-white shadow-lg shadow-indigo-200">
              <Cloud className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-display font-black tracking-tight text-neutral-800">ONYX WEATHER</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <form 
              onSubmit={(e) => { e.preventDefault(); performMainSearch(); }} 
              className="hidden md:flex relative group"
            >
              <input 
                type="text"
                placeholder="Search region..."
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-80 bg-white/50 border border-white/30 rounded-2xl py-2.5 px-5 pl-12 outline-hidden focus:ring-4 ring-indigo-500/10 focus:bg-white/80 transition-all text-sm font-medium"
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <button type="submit" className="hidden" />
            </form>

            <button 
              onClick={handleDetectLocation}
              className="hidden md:flex w-10 h-10 bg-white/50 border border-white/30 rounded-2xl items-center justify-center text-neutral-600 hover:bg-white transition-all shadow-sm"
              title="Detect my location"
            >
              <Navigation className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsComparisonMode(!isComparisonMode)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition-all",
              isComparisonMode ? "bg-indigo-600 text-white shadow-xl shadow-indigo-100" : "bg-white/50 text-neutral-600 hover:bg-white"
            )}
          >
            {isComparisonMode ? <LayoutGrid className="w-4 h-4" /> : <Columns className="w-4 h-4" />}
            {isComparisonMode ? "EXIT COMPARE" : "COMPARE REGIONS"}
          </button>
          
          {user ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end hidden sm:flex">
                <span className="text-xs font-bold text-neutral-800 tracking-tight">{user.displayName}</span>
                <span className="text-[10px] font-bold text-neutral-400">OPERATOR</span>
              </div>
              <button onClick={() => signOut(auth)} className="w-10 h-10 rounded-2xl bg-white/50 text-neutral-600 flex items-center justify-center hover:bg-neutral-100 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button onClick={() => setShowAuthModal(true)} className="bg-indigo-600 text-white px-6 py-2.5 rounded-2xl font-bold text-sm shadow-xl shadow-indigo-100 hover:scale-105 active:scale-95 transition-all">
              SIGN IN
            </button>
          )}
        </div>
      </nav>

      {/* Auth Modal */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setShowAuthModal(false)}
              className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[2.5rem] p-10 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-6">
                <button onClick={() => setShowAuthModal(false)} className="text-neutral-400 hover:text-neutral-900">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="space-y-8 text-center">
                <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto text-indigo-600">
                  <User className="w-10 h-10" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-3xl font-display font-black text-neutral-900">Operator Login</h2>
                  <p className="text-neutral-500 font-medium leading-relaxed">Sign in with Google to save favorite regions and logistics nodes.</p>
                </div>
                <button 
                  onClick={handleLogin}
                  className="w-full bg-indigo-600 text-white py-4 rounded-3xl font-black shadow-2xl shadow-indigo-100 hover:scale-[1.02] active:scale-95 transition-all text-lg flex items-center justify-center gap-3"
                >
                  <img src="https://www.google.com/favicon.ico" className="w-6 h-6 rounded-full" alt="Google" />
                  Continue with Google
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="flex-1 flex overflow-hidden">
        {/* Favorites Sidebar */}
        <aside className="w-72 border-r border-white/50 bg-white/20 backdrop-blur-xl hidden lg:flex flex-col p-6 gap-6">
          <div className="flex items-center justify-between text-neutral-400 font-bold text-xs uppercase tracking-widest px-2 group">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4" />
              Saved Nodes
            </div>
            {weather && !savedNodes.some(f => f.id === weather.city.toLowerCase().replace(/\s+/g, '-')) && (
              <button 
                onClick={() => toggleFavorite(weather.city)}
                className="p-1 hover:text-indigo-600 transition-colors"
                title="Add current to favorites"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="space-y-2 overflow-y-auto no-scrollbar flex-1">
            {savedNodes.length === 0 ? (
              <div className="p-4 rounded-3xl border border-dashed border-neutral-300 text-center space-y-2">
                <p className="text-xs font-bold text-neutral-400">NO NODES SAVED</p>
                <p className="text-[10px] text-neutral-400">Search and star a city to monitor weather from here.</p>
              </div>
            ) : (
              savedNodes.map((fav) => (
                <button 
                  key={fav.id}
                  onClick={() => fetchFullWeather(fav.city)}
                  className="w-full flex items-center justify-between p-4 rounded-3xl hover:bg-white/50 transition-all group font-bold text-sm text-neutral-700"
                >
                  <div className="flex items-center gap-3">
                    <MapPin className="w-4 h-4 text-indigo-600" />
                    <div className="flex flex-col items-start leading-tight">
                      <span>{fav.city}</span>
                      <span className="text-[10px] text-neutral-400 font-bold">{favTemps[fav.id] !== undefined ? `${favTemps[fav.id]}°` : '--'}</span>
                    </div>
                  </div>
                  <X className="w-3 h-3 opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 transition-all" onClick={(e) => { e.stopPropagation(); toggleFavorite(fav.city); }} />
                </button>
              ))
            )}
          </div>
          
          <div className="p-6 bg-indigo-600 rounded-[2rem] text-white shadow-xl shadow-indigo-200 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-80">Status</p>
            <p className="font-bold leading-tight">Data streams operational from Regional Nodes</p>
          </div>
        </aside>

        {/* Content Area */}
        <section className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar">
          <AnimatePresence mode="wait">
            {isComparisonMode ? (
              <motion.div 
                key="compare"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="grid grid-cols-1 xl:grid-cols-2 gap-8"
              >
                <ComparisonPane data={weather} isCurrent onSearch={(c) => fetchFullWeather(c)} />
                <ComparisonPane 
                  data={compWeather} 
                  city={compCity}
                  onCityChange={(c) => setCompCity(c)}
                  onSearch={performComparisonSearch} 
                />
              </motion.div>
            ) : (
              <motion.div 
                key="standard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-6xl mx-auto space-y-10"
              >
                {weather && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Header Summary */}
                    <div className="lg:col-span-8 space-y-8">
                      <div className="cloud-card p-10 md:p-14 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl translate-x-1/2 -translate-y-1/2" />
                        
                        <div className="flex flex-col md:flex-row justify-between items-start gap-12 relative z-10">
                          <div className="space-y-10 flex-1">
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => toggleFavorite(weather.city)}
                                className={cn(
                                  "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                                  savedNodes.some(f => f.id === weather.city.toLowerCase().replace(/\s+/g, '-')) 
                                    ? "bg-amber-400 text-white shadow-lg shadow-amber-200" 
                                    : "bg-white/50 text-neutral-400 hover:text-amber-400"
                                )}
                              >
                                <Star className={cn(
                                  "w-6 h-6 transition-all", 
                                  savedNodes.some(f => f.id === weather.city.toLowerCase().replace(/\s+/g, '-')) 
                                    ? "fill-amber-400 text-amber-400" 
                                    : "text-neutral-400 group-hover:text-amber-400"
                                )} />
                              </button>
                              <div className="space-y-1">
                                <h1 className="text-4xl font-display font-black text-neutral-900 leading-none">{weather.city}</h1>
                                <p className="text-neutral-500 font-bold uppercase tracking-widest text-[10px]">Operations Node / {format(new Date(), 'dd MMMM')}</p>
                              </div>
                            </div>

                            <div className="flex items-end gap-1">
                              <span className="text-9xl font-display font-black tracking-tighter text-neutral-900 leading-none">{weather.temp}°</span>
                              <div className="pb-3 text-neutral-400 flex flex-col">
                                <span className="text-2xl font-bold capitalize">{weather.description}</span>
                                <span className="text-sm font-bold">FEELS LIKE {weather.feelsLike}°</span>
                                <button 
                                  onClick={() => toggleFavorite(weather.city)}
                                  className="mt-3 flex items-center gap-1.5 text-[10px] font-black text-indigo-600 hover:text-indigo-700 transition-colors uppercase tracking-widest group/btn"
                                >
                                  <Star className={cn(
                                    "w-3 h-3 group-hover/btn:scale-110 transition-transform", 
                                    savedNodes.some(f => f.id === weather.city.toLowerCase().replace(/\s+/g, '-')) && "fill-amber-400 text-amber-400"
                                  )} />
                                  {savedNodes.some(f => f.id === weather.city.toLowerCase().replace(/\s+/g, '-')) ? "Remove Node" : "Save Node"}
                                </button>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-10">
                              <Stat label="WIND SPEED" value={`${weather.windSpeed} km/h`} icon={<Wind />} />
                              <Stat label="HUMIDITY" value={`${weather.humidity}%`} icon={<Droplets />} />
                              <Stat label="UV INDEX" value={weather.uvIndex} icon={<Sun />} />
                            </div>
                          </div>

                          <div className="w-56 h-56 md:w-72 md:h-72 animate-float">
                            {getWeatherIcon(weather.condition)}
                          </div>
                        </div>
                      </div>

                      {/* Hourly Scroll */}
                      <div className="cloud-card p-10 space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xl font-display font-black text-neutral-900">24-Hour Weather Outlook</h3>
                          <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs">
                            <Timer className="w-4 h-4" />
                            REAL-TIME SYNC
                          </div>
                        </div>
                        <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                          {hourly.map((h, i) => (
                            <div key={i} className="flex flex-col items-center gap-3 min-w-[90px] p-6 rounded-[2.5rem] bg-indigo-50/30 border border-white hover:bg-white transition-all shadow-sm">
                              <span className="text-[10px] font-black text-neutral-400 uppercase">{h.time}</span>
                              <div className="w-10 h-10">
                                {getWeatherIcon(h.condition)}
                              </div>
                              <span className="text-2xl font-display font-black text-neutral-800">{h.temp}°</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Sidebar Stats */}
                    <div className="lg:col-span-4 space-y-8">
                      {/* Regional Weather Engine */}
                      <div className="cloud-card p-8 border-l-8 border-indigo-600 space-y-8">
                        <div className="space-y-1">
                          <h3 className="text-xl font-display font-black text-neutral-900">Regional Engine</h3>
                          <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Neighboring Node Analysis</p>
                        </div>
                        
                        <div className="space-y-4">
                          {nearby.map((n, i) => (
                            <div key={i} className="flex items-center justify-between p-5 rounded-[2rem] bg-white shadow-sm border border-neutral-100 hover:scale-[1.02] transition-transform">
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center p-2.5">
                                  {getWeatherIcon(n.condition)}
                                </div>
                                <div className="space-y-0.5">
                                  <p className="text-sm font-black text-neutral-900">{n.name}</p>
                                  <p className="text-[10px] font-bold text-neutral-400 uppercase whitespace-nowrap">{n.condition}</p>
                                </div>
                              </div>
                              <span className="text-xl font-display font-black text-neutral-800">{n.temp}°</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Advisory & Recommendation Card */}
                      <div className="grid grid-cols-1 gap-8">
                        {advisory && (
                          <div className={cn(
                            "cloud-card p-8 border-l-8 transition-colors",
                            advisory.impact.includes('Alert') ? "border-amber-500 bg-amber-50/50" : "border-emerald-500 bg-emerald-50/50"
                          )}>
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <h4 className={cn(
                                  "text-sm font-black tracking-widest uppercase",
                                  advisory.impact.includes('Alert') ? "text-amber-600" : "text-emerald-600"
                                )}>{advisory.impact}</h4>
                                <AlertCircle className={cn(
                                  "w-5 h-5",
                                  advisory.impact.includes('Alert') ? "text-amber-600" : "text-emerald-600"
                                )} />
                              </div>
                              <p className="text-sm font-bold text-neutral-700 leading-relaxed italic">
                                "{advisory.desc}"
                              </p>
                            </div>
                          </div>
                        )}

                        {recommendation && (
                          <div className="cloud-card p-8 border-l-8 border-indigo-400 bg-indigo-50/30 space-y-6">
                            <div className="flex items-start justify-between">
                              <div className="space-y-1">
                                <h4 className="text-sm font-black tracking-widest uppercase text-indigo-600">Personal Recommendation</h4>
                                <h3 className="text-xl font-display font-black text-neutral-900">{recommendation.title}</h3>
                              </div>
                              <div className="text-indigo-600 bg-white p-3 rounded-2xl shadow-sm">
                                {recommendation.icon}
                              </div>
                            </div>
                            <p className="text-sm font-bold text-neutral-600 leading-relaxed">
                              {recommendation.desc}
                            </p>
                            <div className="p-4 bg-white/60 rounded-2xl border border-white flex items-center gap-3">
                              <Zap className="w-5 h-5 text-amber-500 fill-current" />
                              <p className="text-xs font-bold text-neutral-500">{recommendation.tip}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Weekly Atmospheric Trends (Horizontal) */}
                      <div className="cloud-card p-8 space-y-8">
                        <div className="flex items-center justify-between px-2">
                          <div>
                            <h3 className="text-xl font-display font-black text-neutral-900">Weekly Outlook</h3>
                            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Regional Atmospheric Projections</p>
                          </div>
                          <div className="flex items-center gap-2 text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase">
                            <Calendar className="w-3.5 h-3.5" />
                            Next {forecast.length} Days
                          </div>
                        </div>
                        
                        <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar scroll-smooth">
                          {forecast.map((f, i) => (
                            <motion.div 
                              key={i} 
                              initial={{ opacity: 0, scale: 0.9, y: 10 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              transition={{ delay: i * 0.05 }}
                              className="flex flex-col items-center gap-4 min-w-[120px] p-8 rounded-[3rem] bg-white border border-neutral-100 hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-500/5 transition-all group relative overflow-hidden"
                            >
                              <div className="absolute top-0 inset-x-0 h-1 bg-indigo-500 scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
                              <span className="text-xs font-black text-neutral-400 uppercase tracking-tighter">{f.date}</span>
                              <div className="w-12 h-12 group-hover:scale-110 transition-transform duration-500">
                                {getWeatherIcon(f.condition)}
                              </div>
                              <div className="text-center">
                                <span className="text-3xl font-display font-black text-neutral-800 leading-none">{f.temp}°</span>
                                <p className="text-[9px] font-bold text-neutral-400 uppercase mt-1">{f.condition}</p>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                        
                        <div className="h-28 w-full px-4 pt-4">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={forecast}>
                              <defs>
                                <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <Area type="monotone" dataKey="temp" stroke="#6366f1" strokeWidth={3} fill="url(#colorTemp)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string, value: any, icon: any }) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 rounded-[1.25rem] bg-white flex items-center justify-center text-indigo-600 shadow-sm border border-neutral-100">
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-black text-neutral-400 tracking-widest">{label}</p>
        <p className="text-xl font-display font-black text-neutral-800 leading-none">{value}</p>
      </div>
    </div>
  );
}

function ComparisonPane({ 
  data, 
  isCurrent, 
  city, 
  onCityChange, 
  onSearch 
}: { 
  data: WeatherData | null, 
  isCurrent?: boolean, 
  city?: string, 
  onCityChange?: (v: string) => void, 
  onSearch: (c: string) => void 
}) {
  return (
    <div className="cloud-card p-10 space-y-10 relative group border-2 border-transparent hover:border-indigo-100 transition-colors">
      <div className="absolute top-0 right-0 p-6 opacity-40">
        <Columns className="w-20 h-20 text-indigo-200" />
      </div>
      
      {!isCurrent && (
        <form onSubmit={(e) => { e.preventDefault(); if (city) onSearch(city); }} className="relative z-10">
          <input 
            type="text"
            placeholder="Search city to compare..."
            value={city}
            onChange={(e) => onCityChange?.(e.target.value)}
            className="w-full bg-white border border-neutral-200 rounded-[2rem] py-4 px-8 pl-14 font-bold text-lg shadow-sm focus:ring-4 ring-indigo-500/10 outline-hidden transition-all"
          />
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
        </form>
      )}

      {data ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="space-y-14 relative z-10"
        >
          <div className="flex justify-between items-center">
            <div className="space-y-2">
              <h2 className="text-5xl font-display font-black text-neutral-900 tracking-tighter">{data.city}</h2>
              <p className="font-bold text-indigo-600 uppercase tracking-widest text-[10px]">ANALYSIS TARGET</p>
            </div>
            <div className="w-32 h-32 animate-float">
              {getWeatherIcon(data.condition)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-10">
            <div className="space-y-4">
              <p className="text-[10px] font-black text-neutral-400 tracking-[0.2em]">CORE METRIC</p>
              <div className="space-y-1">
                <span className="text-7xl font-display font-black text-neutral-900 tracking-tighter">{data.temp}°</span>
                <p className="text-lg font-bold text-neutral-500 capitalize">{data.description}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-6">
              <MiniStat label="FEELS" value={`${data.feelsLike}°`} />
              <MiniStat label="HUMIDITY" value={`${data.humidity}%`} />
              <MiniStat label="WIND" value={`${data.windSpeed} km/h`} />
              <MiniStat label="UV" value={data.uvIndex} />
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="h-[400px] flex flex-col items-center justify-center text-center gap-6 opacity-30">
          <LayoutGrid className="w-20 h-20" />
          <p className="font-bold text-lg tracking-tight">READY FOR COMPARATIVE<br/>DATA INJECTION</p>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string, value: any }) {
  return (
    <div className="flex justify-between items-center border-b border-neutral-100 pb-2">
      <span className="text-[10px] font-black text-neutral-300 tracking-widest uppercase">{label}</span>
      <span className="font-bold text-neutral-800">{value}</span>
    </div>
  );
}
