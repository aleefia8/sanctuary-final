/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, 
  Moon, 
  Smile, 
  Heart, 
  Zap, 
  ChevronRight, 
  Lock, 
  CheckCircle2, 
  User as UserIcon, 
  LogOut, 
  Search, 
  MessageSquare,
  TrendingUp,
  Award,
  ShieldCheck,
  Stethoscope
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  onSnapshot, 
  query, 
  where, 
  Timestamp,
  handleFirestoreError,
  OperationType
} from './firebase';
import { getHealthAdvice } from './geminiService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Error Boundary ---
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          displayMessage = "Access denied. Please check your permissions.";
        }
      } catch (e) {
        // Not a JSON error
      }
      return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-center">
          <h2 className="text-2xl font-bold text-rose-500 mb-4">System Error</h2>
          <p className="text-white/60 mb-8">{displayMessage}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-white text-black rounded-xl font-bold"
          >
            Reload System
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Types ---
interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  tier: 'free' | 'commitment' | 'transformation' | 'clinical';
  credits: number;
  metabolicAge: number;
  healthScore: number;
  exp: number;
  streak: number;
  createdAt: string;
}

interface Badge {
  id: string;
  name: string;
  icon: string;
  earnedAt: string;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  rewardCredits: number;
  status: 'active' | 'completed' | 'failed';
}

interface BiometricLog {
  id: string;
  date: string;
  sleepHours: number;
  mood: number;
  heartRate: number;
  metabolicMarker: number;
}

interface Habit {
  id: string;
  name: string;
  completed: boolean;
  date: string;
}

// --- Components ---

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-6", className)}>
    {children}
  </div>
);

const StatCard = ({ icon: Icon, label, value, unit, color }: { icon: any, label: string, value: string | number, unit?: string, color: string }) => (
  <Card className="flex flex-col gap-4">
    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", color)}>
      <Icon className="w-5 h-5 text-white" />
    </div>
    <div>
      <p className="text-white/50 text-xs uppercase tracking-wider font-medium">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-white">{value}</span>
        {unit && <span className="text-white/30 text-sm">{unit}</span>}
      </div>
    </div>
  </Card>
);

const TierCard = ({ 
  tier, 
  title, 
  price, 
  features, 
  current, 
  onUpgrade, 
  highlight = false 
}: { 
  tier: string, 
  title: string, 
  price: string, 
  features: string[], 
  current: boolean, 
  onUpgrade: () => void,
  highlight?: boolean
}) => (
  <Card className={cn(
    "flex flex-col gap-6 transition-all duration-300",
    highlight ? "border-emerald-500/50 bg-emerald-500/5" : "hover:border-white/30",
    current && "border-white/50 bg-white/5"
  )}>
    <div className="flex justify-between items-start">
      <div>
        <h3 className="text-xl font-semibold text-white">{title}</h3>
        <p className="text-2xl font-bold text-white mt-1">{price}</p>
      </div>
      {current && (
        <span className="px-3 py-1 rounded-full bg-white/10 text-white text-[10px] uppercase tracking-widest font-bold">
          Current Plan
        </span>
      )}
    </div>
    <ul className="flex flex-col gap-3 flex-grow">
      {features.map((f, i) => (
        <li key={i} className="flex items-center gap-2 text-sm text-white/70">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          {f}
        </li>
      ))}
    </ul>
    <button 
      onClick={onUpgrade}
      disabled={current}
      className={cn(
        "w-full py-3 rounded-2xl font-semibold transition-all",
        current 
          ? "bg-white/5 text-white/30 cursor-not-allowed" 
          : highlight 
            ? "bg-emerald-500 text-black hover:bg-emerald-400" 
            : "bg-white text-black hover:bg-white/90"
      )}
    >
      {current ? "Active" : "Upgrade"}
    </button>
  </Card>
);

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [biometrics, setBiometrics] = useState<BiometricLog[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [aiMessage, setAiMessage] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'programs' | 'coach'>('dashboard');

  // --- Auth & Data Sync ---
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userRef = doc(db, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userRef);

          if (!userSnap.exists()) {
            const newUser: UserProfile = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName || 'User',
              email: firebaseUser.email || '',
              tier: 'free',
              credits: 0,
              metabolicAge: 30, // Default
              healthScore: 65, // Default
              exp: 0,
              streak: 0,
              createdAt: new Date().toISOString(),
            };
            await setDoc(userRef, newUser);
            setUser(newUser);
          } else {
            setUser(userSnap.data() as UserProfile);
          }

          // Sync Biometrics
          const bioPath = `users/${firebaseUser.uid}/biometrics`;
          const bioQuery = query(collection(db, bioPath));
          const bioUnsub = onSnapshot(bioQuery, (snap) => {
            const logs = snap.docs.map(d => ({ id: d.id, ...d.data() } as BiometricLog));
            setBiometrics(logs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
          }, (error) => {
            handleFirestoreError(error, OperationType.GET, bioPath);
          });

          // Sync Habits
          const habitPath = `users/${firebaseUser.uid}/habits`;
          const habitQuery = query(collection(db, habitPath));
          const habitUnsub = onSnapshot(habitQuery, (snap) => {
            setHabits(snap.docs.map(d => ({ id: d.id, ...d.data() } as Habit)));
          }, (error) => {
            handleFirestoreError(error, OperationType.GET, habitPath);
          });

          // Sync Badges
          const badgePath = `users/${firebaseUser.uid}/badges`;
          const badgeUnsub = onSnapshot(collection(db, badgePath), (snap) => {
            setBadges(snap.docs.map(d => ({ id: d.id, ...d.data() } as Badge)));
          });

          // Sync Challenges
          const challengePath = `users/${firebaseUser.uid}/challenges`;
          const challengeUnsub = onSnapshot(collection(db, challengePath), (snap) => {
            setChallenges(snap.docs.map(d => ({ id: d.id, ...d.data() } as Challenge)));
          });

          setLoading(false);
          return () => {
            bioUnsub();
            habitUnsub();
            badgeUnsub();
            challengeUnsub();
          };
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'users');
        }
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Sign in error:", error);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleUpgrade = async (tier: UserProfile['tier']) => {
    if (!user) return;
    const path = `users/${user.uid}`;
    try {
      const userRef = doc(db, path);
      await setDoc(userRef, { tier }, { merge: true });
      setUser({ ...user, tier });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const askAi = async () => {
    if (!aiMessage.trim() || !user) return;
    setAiLoading(true);
    const context = {
      userTier: user.tier,
      healthScore: user.healthScore,
      metabolicAge: user.metabolicAge,
      recentBiometrics: biometrics.slice(-3),
    };
    const response = await getHealthAdvice(aiMessage, context);
    setAiMessage("");
    // In a real app, we'd store the chat history in Firestore
    alert(response); // Simplified for demo
    setAiLoading(false);
  };

  // --- Render Helpers ---
  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <motion.div 
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-emerald-500 font-display text-4xl uppercase tracking-[0.5em]"
        >
          Sanctuary
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-6 overflow-hidden relative">
        {/* Atmospheric Background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-emerald-500/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-blue-500/10 blur-[120px] rounded-full" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="z-10 text-center max-w-2xl"
        >
          <h1 className="text-7xl md:text-9xl font-bold text-white tracking-tighter leading-none mb-8">
            SANCTUARY<span className="text-emerald-500">OS</span>
          </h1>
          <p className="text-white/50 text-xl font-light mb-12 leading-relaxed">
            The ultimate health operating system. <br/>
            Biometric precision. AI-driven transformation.
          </p>
          <button 
            onClick={handleSignIn}
            className="group relative px-12 py-5 bg-white text-black rounded-full font-bold text-lg overflow-hidden transition-all hover:scale-105"
          >
            <span className="relative z-10 flex items-center gap-3">
              Initialize System <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </span>
            <div className="absolute inset-0 bg-emerald-400 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-24">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/50 backdrop-blur-xl border-b border-white/5 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Zap className="w-6 h-6 text-black" />
            </div>
            <span className="text-xl font-bold tracking-tight">Sanctuary<span className="text-emerald-500">OS</span></span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-xs text-white/40 uppercase tracking-widest font-bold">Current Tier</span>
              <span className="text-sm font-semibold text-emerald-400 capitalize">{user.tier}</span>
            </div>
            <button 
              onClick={handleSignOut}
              className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/50 hover:text-white"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Hero Section */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <Card className="lg:col-span-2 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
              <Activity className="w-48 h-48 text-emerald-500" />
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-emerald-500 mb-4">
                <ShieldCheck className="w-5 h-5" />
                <span className="text-xs uppercase tracking-[0.2em] font-bold">System Status: Optimized</span>
              </div>
              <h2 className="text-5xl font-bold mb-2">Welcome, {user.displayName.split(' ')[0]}</h2>
              <p className="text-white/50 text-lg mb-8">Your metabolic age is <span className="text-white font-semibold">{user.metabolicAge}</span>. You are performing <span className="text-emerald-400 font-semibold">5 years younger</span> than your biological age.</p>
              
              <div className="flex gap-4">
                <button 
                  onClick={() => setActiveTab('coach')}
                  className="px-6 py-3 bg-white text-black rounded-2xl font-bold hover:bg-white/90 transition-all"
                >
                  Consult AI Coach
                </button>
                <button 
                  onClick={() => setActiveTab('programs')}
                  className="px-6 py-3 bg-white/5 border border-white/10 rounded-2xl font-bold hover:bg-white/10 transition-all"
                >
                  View Programs
                </button>
              </div>
            </div>
          </Card>

          <Card className="flex flex-col items-center justify-center text-center">
            <div className="relative w-40 h-40 mb-4">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="80"
                  cy="80"
                  r="70"
                  fill="transparent"
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="12"
                />
                <circle
                  cx="80"
                  cy="80"
                  r="70"
                  fill="transparent"
                  stroke="#10b981"
                  strokeWidth="12"
                  strokeDasharray={440}
                  strokeDashoffset={440 - (440 * user.healthScore) / 100}
                  strokeLinecap="round"
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-5xl font-bold">{user.healthScore}</span>
                <span className="text-[10px] text-white/40 uppercase tracking-widest font-bold">Health Score</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center">
                <span className="text-emerald-400 text-lg font-bold">{user.streak}</span>
                <span className="text-[8px] text-white/40 uppercase font-bold">Streak</span>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex flex-col items-center">
                <span className="text-emerald-400 text-lg font-bold">{user.exp}</span>
                <span className="text-[8px] text-white/40 uppercase font-bold">EXP</span>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex flex-col items-center">
                <span className="text-emerald-400 text-lg font-bold">{user.credits}</span>
                <span className="text-[8px] text-white/40 uppercase font-bold">Credits</span>
              </div>
            </div>
          </Card>
        </section>

        {/* Navigation Tabs */}
        <div className="flex gap-2 p-1 bg-white/5 rounded-2xl w-fit mx-auto">
          {(['dashboard', 'programs', 'coach'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-6 py-2 rounded-xl text-sm font-semibold capitalize transition-all",
                activeTab === tab ? "bg-white text-black shadow-lg" : "text-white/50 hover:text-white"
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={Moon} label="Sleep" value="7.5" unit="hrs" color="bg-indigo-500" />
                <StatCard icon={Smile} label="Mood" value="8" unit="/10" color="bg-amber-500" />
                <StatCard icon={Heart} label="Heart Rate" value="62" unit="bpm" color="bg-rose-500" />
                <StatCard icon={Activity} label="Metabolic" value="94" unit="score" color="bg-emerald-500" />
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card className="h-[400px] flex flex-col">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                    Health Score Trend
                  </h3>
                  <div className="flex-grow">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={(biometrics.length > 0 ? biometrics : [
                        { date: 'Mon', metabolicMarker: 65 },
                        { date: 'Tue', metabolicMarker: 68 },
                        { date: 'Wed', metabolicMarker: 67 },
                        { date: 'Thu', metabolicMarker: 72 },
                        { date: 'Fri', metabolicMarker: 75 },
                        { date: 'Sat', metabolicMarker: 74 },
                        { date: 'Sun', metabolicMarker: 78 },
                      ]) as any[]}>
                        <defs>
                          <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="date" stroke="rgba(255,255,255,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                          itemStyle={{ color: '#fff' }}
                        />
                        <Area type="monotone" dataKey="metabolicMarker" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorScore)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card className="flex flex-col">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <Award className="w-5 h-5 text-amber-500" />
                    Daily Habits
                  </h3>
                  <div className="space-y-4">
                    {[
                      { name: 'Hydration (3L)', completed: true },
                      { name: 'Cold Plunge', completed: true },
                      { name: 'Meditation (10m)', completed: false },
                      { name: 'No Caffeine after 2PM', completed: true },
                      { name: 'Zone 2 Cardio (30m)', completed: false },
                    ].map((habit, i) => (
                      <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                        <span className={cn("font-medium", habit.completed ? "text-white/50 line-through" : "text-white")}>
                          {habit.name}
                        </span>
                        <div className={cn(
                          "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                          habit.completed ? "bg-emerald-500 border-emerald-500" : "border-white/20"
                        )}>
                          {habit.completed && <CheckCircle2 className="w-4 h-4 text-black" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* Badges & Challenges */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <Card className="lg:col-span-1">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <Award className="w-5 h-5 text-amber-500" />
                    Earned Badges
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    {(badges.length > 0 ? badges : [
                      { id: '1', name: 'Early Bird', icon: 'Moon' },
                      { id: '2', name: 'Hydrator', icon: 'Zap' },
                      { id: '3', name: 'Zen Master', icon: 'Smile' },
                    ]).map((badge, i) => (
                      <div key={i} className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center group hover:border-amber-500/50 transition-all cursor-help">
                          <Award className="w-6 h-6 text-white/30 group-hover:text-amber-500 transition-colors" />
                        </div>
                        <span className="text-[10px] text-white/50 text-center font-medium">{badge.name}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="lg:col-span-2">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <Zap className="w-5 h-5 text-emerald-500" />
                    Active Challenges
                  </h3>
                  <div className="space-y-4">
                    {(challenges.length > 0 ? challenges : [
                      { id: '1', title: '7-Day Sleep Reset', description: 'Get 7+ hours of sleep for 7 days straight.', rewardCredits: 50, status: 'active' },
                      { id: '2', title: 'Metabolic Sprint', description: 'Complete 5 Zone 2 cardio sessions this week.', rewardCredits: 100, status: 'active' },
                    ]).map((challenge, i) => (
                      <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 hover:border-emerald-500/30 transition-all">
                        <div>
                          <h4 className="font-bold text-white">{challenge.title}</h4>
                          <p className="text-xs text-white/40">{challenge.description}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <span className="text-emerald-400 font-bold">+{challenge.rewardCredits}</span>
                            <p className="text-[8px] text-white/40 uppercase font-bold">Credits</p>
                          </div>
                          <button className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold transition-all">
                            Details
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </motion.div>
          )}

          {activeTab === 'programs' && (
            <motion.div 
              key="programs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-12"
            >
              <div className="text-center max-w-2xl mx-auto">
                <h2 className="text-4xl font-bold mb-4">Transformation Ladder</h2>
                <p className="text-white/50">Choose your level of commitment and unlock your full metabolic potential.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <TierCard 
                  tier="free"
                  title="Sanctuary Open"
                  price="Free"
                  features={["Basic tracking", "Limited AI guidance", "1 active challenge", "Community access"]}
                  current={user.tier === 'free'}
                  onUpgrade={() => handleUpgrade('free')}
                />
                <TierCard 
                  tier="commitment"
                  title="Commitment"
                  price="$4.99"
                  features={["Metabolic Reset program", "Streak tracking", "Basic personalization", "Reward eligibility"]}
                  current={user.tier === 'commitment'}
                  onUpgrade={() => handleUpgrade('commitment')}
                  highlight={user.tier === 'free'}
                />
                <TierCard 
                  tier="transformation"
                  title="Transformation"
                  price="$19.99"
                  features={["Full 30-day programs", "Daily habit system", "Advanced AI coaching", "Progress analytics"]}
                  current={user.tier === 'transformation'}
                  onUpgrade={() => handleUpgrade('transformation')}
                  highlight={user.tier === 'commitment'}
                />
                <TierCard 
                  tier="clinical"
                  title="Clinical Access"
                  price="$149"
                  features={["Advanced health report", "Lab recommendations", "Priority clinician matching", "CGM onboarding"]}
                  current={user.tier === 'clinical'}
                  onUpgrade={() => handleUpgrade('clinical')}
                />
              </div>

              <Card className="bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border-emerald-500/30">
                <div className="flex flex-col md:flex-row items-center gap-8 p-4">
                  <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shrink-0">
                    <Stethoscope className="w-10 h-10 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold mb-2">Bridge to Clinical Care</h3>
                    <p className="text-white/70 mb-4">Turn your daily progress into real medical insight. Our clinical tier connects your biometric data directly to licensed practitioners for a holistic longevity strategy.</p>
                    <div className="flex gap-4">
                      <span className="px-3 py-1 bg-white/10 rounded-lg text-xs font-bold uppercase tracking-widest">Lab-Verified</span>
                      <span className="px-3 py-1 bg-white/10 rounded-lg text-xs font-bold uppercase tracking-widest">MD-Supervised</span>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === 'coach' && (
            <motion.div 
              key="coach"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              <div className="lg:col-span-2 space-y-8">
                <Card className="h-[600px] flex flex-col">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center">
                      <MessageSquare className="w-6 h-6 text-black" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">Sanctuary AI Coach</h3>
                      <p className="text-xs text-emerald-400 font-medium uppercase tracking-widest">Clinical-Grade Intelligence</p>
                    </div>
                  </div>

                  <div className="flex-grow overflow-y-auto space-y-6 mb-6 pr-4 custom-scrollbar">
                    <div className="flex gap-4">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                        <Zap className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div className="bg-white/5 rounded-2xl p-4 text-sm text-white/80 leading-relaxed max-w-[80%]">
                        Hello {user.displayName.split(' ')[0]}. I've analyzed your biometric data from the last 24 hours. Your sleep efficiency was 92%, but your resting heart rate is slightly elevated. Would you like to explore potential causes or adjust today's protocol?
                      </div>
                    </div>
                  </div>

                  <div className="relative">
                    <input 
                      type="text" 
                      value={aiMessage}
                      onChange={(e) => setAiMessage(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && askAi()}
                      placeholder="Ask about your metabolic health..."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-6 pr-16 focus:outline-none focus:border-emerald-500/50 transition-all"
                    />
                    <button 
                      onClick={askAi}
                      disabled={aiLoading}
                      className="absolute right-2 top-2 bottom-2 px-4 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all disabled:opacity-50"
                    >
                      {aiLoading ? <Activity className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-white/30 text-center mt-4 uppercase tracking-widest">Powered by Gemini 3 Flash • Google Search Grounding Enabled</p>
                </Card>
              </div>

              <div className="space-y-8">
                <Card>
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    Daily Protocol
                  </h3>
                  <div className="space-y-4">
                    {[
                      { name: 'Metabolic Check-in', time: '08:00 AM', status: 'completed' },
                      { name: 'Zone 2 Cardio', time: '10:00 AM', status: 'pending' },
                      { name: 'Protein Load (40g)', time: '01:00 PM', status: 'pending' },
                      { name: 'Deep Work Block', time: '02:00 PM', status: 'pending' },
                      { name: 'Magnesium Load', time: '09:00 PM', status: 'pending' },
                    ].map((action, i) => (
                      <div key={i} className="flex items-center gap-4 p-3 bg-white/5 rounded-xl border border-white/5">
                        <div className={cn(
                          "w-2 h-2 rounded-full",
                          action.status === 'completed' ? "bg-emerald-500" : "bg-white/20"
                        )} />
                        <div>
                          <p className="text-sm font-bold">{action.name}</p>
                          <p className="text-[10px] text-white/40 uppercase font-bold">{action.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="w-full mt-6 py-3 bg-white/5 border border-white/10 rounded-xl text-xs font-bold hover:bg-white/10 transition-all">
                    View Full Schedule
                  </button>
                </Card>

                <Card className="bg-emerald-500/5 border-emerald-500/20">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                    Program Progress
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold uppercase tracking-widest">
                      <span>Metabolic Reset</span>
                      <span className="text-emerald-400">Day 12/30</span>
                    </div>
                    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 w-[40%]" />
                    </div>
                    <p className="text-[10px] text-white/40 mt-2">You're on track to earn <span className="text-white font-bold">250 Credits</span> upon completion.</p>
                  </div>
                </Card>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Mobile Navigation */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 md:hidden">
        <div className="bg-black/80 backdrop-blur-2xl border border-white/10 rounded-full px-6 py-3 flex items-center gap-8 shadow-2xl">
          <button onClick={() => setActiveTab('dashboard')} className={cn("p-2 transition-all", activeTab === 'dashboard' ? "text-emerald-500 scale-110" : "text-white/40")}>
            <Activity className="w-6 h-6" />
          </button>
          <button onClick={() => setActiveTab('programs')} className={cn("p-2 transition-all", activeTab === 'programs' ? "text-emerald-500 scale-110" : "text-white/40")}>
            <Award className="w-6 h-6" />
          </button>
          <button onClick={() => setActiveTab('coach')} className={cn("p-2 transition-all", activeTab === 'coach' ? "text-emerald-500 scale-110" : "text-white/40")}>
            <MessageSquare className="w-6 h-6" />
          </button>
        </div>
      </nav>
    </div>
  );
}
