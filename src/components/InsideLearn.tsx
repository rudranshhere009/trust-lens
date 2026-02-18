import { useEffect, useMemo, useState } from "react";
import { BookOpen, Play, CheckCircle2, Brain, Award } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AppTrack } from "@/utils/insideData";
import {
  COURSES,
  QUIZ_BANK,
  createAttemptId,
  loadInsideLearnStore,
  updateInsideLearnStore,
  type LearnCourse,
} from "@/utils/insideLearnData";
import { SECTION_ACTION_EVENT, isSectionActionDetail } from "@/utils/sectionActionEvents";

interface InsideLearnProps {
  mode: AppTrack;
}

const ACTION_KEYWORDS: Record<AppTrack, Record<string, string>> = {
  legal: {
    "Contract review SOP": "Legal Investigation",
    "Litigation risk checklist": "Clause Risk",
    "Evidence handling module": "Evidence",
    "Scenario drills": "Investigation",
  },
  compliance: {
    "Control design training": "Compliance Ops",
    "Audit simulations": "Audit",
    "Incident tabletop": "Vendor",
    "Certification path": "Compliance",
  },
  truthdesk: {
    "Source vetting": "Fact-Check",
    "OSINT basics": "Fact-Check",
    "Narrative mapping": "Narrative",
    "Editorial integrity drills": "Narrative",
  },
};

export const InsideLearn = ({ mode }: InsideLearnProps) => {
  const [store, setStore] = useState(() => loadInsideLearnStore());
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [quizIndex, setQuizIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [quizFeedback, setQuizFeedback] = useState("");

  const courses = useMemo(() => COURSES.filter((c) => c.track === mode), [mode]);
  const activeCourse = courses.find((c) => c.id === activeCourseId) ?? null;

  const progressMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of store.progress.filter((x) => x.track === mode)) {
      map.set(p.courseId, p.progress);
    }
    return map;
  }, [store.progress, mode]);

  const completedCount = useMemo(
    () => store.progress.filter((x) => x.track === mode && x.completed).length,
    [store.progress, mode]
  );

  const totalAttempts = useMemo(
    () => store.attempts.filter((x) => x.track === mode).length,
    [store.attempts, mode]
  );

  const correctAttempts = useMemo(
    () => store.attempts.filter((x) => x.track === mode && x.correct).length,
    [store.attempts, mode]
  );

  const quizItems = QUIZ_BANK[mode];
  const currentQuiz = quizItems[quizIndex % quizItems.length];

  const sync = (updater: Parameters<typeof updateInsideLearnStore>[0]) => {
    const next = updateInsideLearnStore(updater);
    setStore(next);
  };

  const bumpCourseProgress = (course: LearnCourse) => {
    const current = progressMap.get(course.id) ?? 0;
    const nextVal = Math.min(100, current + Math.ceil(100 / course.lessons.length));
    sync((currentStore) => {
      const existing = currentStore.progress.find((p) => p.courseId === course.id && p.track === mode);
      const updated = {
        courseId: course.id,
        track: mode,
        progress: nextVal,
        completed: nextVal >= 100,
        lastLessonId: course.lessons[Math.min(course.lessons.length - 1, Math.floor((nextVal / 100) * course.lessons.length))]?.id,
        updatedAt: Date.now(),
      };

      return {
        ...currentStore,
        progress: existing
          ? currentStore.progress.map((p) => (p.courseId === course.id && p.track === mode ? updated : p))
          : [updated, ...currentStore.progress],
      };
    });
  };

  const startCourse = (course: LearnCourse) => {
    setActiveCourseId(course.id);
    if (!progressMap.has(course.id)) {
      sync((currentStore) => ({
        ...currentStore,
        progress: [
          {
            courseId: course.id,
            track: mode,
            progress: 0,
            completed: false,
            updatedAt: Date.now(),
          },
          ...currentStore.progress,
        ],
      }));
    }
  };

  const submitQuiz = () => {
    if (!selectedAnswer) return;
    const correct = selectedAnswer === currentQuiz.correct;
    setQuizFeedback(correct ? "Correct answer." : `Incorrect. Correct: ${currentQuiz.correct}`);
    sync((currentStore) => ({
      ...currentStore,
      attempts: [
        {
          id: createAttemptId(),
          track: mode,
          question: currentQuiz.question,
          answer: selectedAnswer,
          correct,
          createdAt: Date.now(),
        },
        ...currentStore.attempts,
      ],
    }));
  };

  const nextQuiz = () => {
    setQuizIndex((x) => (x + 1) % quizItems.length);
    setSelectedAnswer("");
    setQuizFeedback("");
  };

  useEffect(() => {
    const onSectionAction = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!isSectionActionDetail(detail) || detail.tab !== "education" || detail.mode !== mode) return;
      const keyword = ACTION_KEYWORDS[mode][detail.action];
      if (!keyword) return;
      const course = courses.find((c) => c.title.includes(keyword) || c.description.includes(keyword));
      if (course) {
        startCourse(course);
        bumpCourseProgress(course);
      } else {
        nextQuiz();
      }
    };
    window.addEventListener(SECTION_ACTION_EVENT, onSectionAction);
    return () => window.removeEventListener(SECTION_ACTION_EVENT, onSectionAction);
  }, [courses, mode, progressMap]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Metric title="Courses" value={courses.length} icon={<BookOpen className="h-4 w-4" />} />
        <Metric title="Completed" value={completedCount} icon={<CheckCircle2 className="h-4 w-4" />} />
        <Metric title="Quiz Attempts" value={totalAttempts} icon={<Brain className="h-4 w-4" />} />
        <Metric title="Correct" value={correctAttempts} icon={<Award className="h-4 w-4" />} />
      </div>

      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>Track Courses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {courses.map((course) => {
            const progress = progressMap.get(course.id) ?? 0;
            return (
              <div key={course.id} className="rounded-md border p-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{course.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {course.description} | {course.level} | {course.lessons.length} lessons | progress {progress}%
                  </div>
                </div>
                <div className="flex gap-2">
                  <Badge variant={progress >= 100 ? "secondary" : "outline"}>{progress >= 100 ? "completed" : "in progress"}</Badge>
                  <Button size="sm" variant="outline" onClick={() => startCourse(course)}>
                    <Play className="h-4 w-4 mr-1" />
                    Open
                  </Button>
                  <Button size="sm" onClick={() => bumpCourseProgress(course)}>
                    + Progress
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {activeCourse ? (
        <Card className="dashboard-card-effect">
          <CardHeader>
            <CardTitle>{activeCourse.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeCourse.lessons.map((lesson, idx) => (
              <div key={lesson.id} className="rounded-md border p-3 flex items-center justify-between">
                <div className="text-sm">
                  {idx + 1}. {lesson.title}
                </div>
                <Badge variant="outline">{lesson.minutes} min</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>Knowledge Check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm font-medium">{currentQuiz.question}</div>
          <div className="grid gap-2">
            {currentQuiz.options.map((option) => (
              <Button
                key={option}
                variant={selectedAnswer === option ? "default" : "outline"}
                className="justify-start"
                onClick={() => setSelectedAnswer(option)}
              >
                {option}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={submitQuiz} disabled={!selectedAnswer}>
              Submit
            </Button>
            <Button variant="outline" onClick={nextQuiz}>
              Next Question
            </Button>
          </div>
          {quizFeedback ? <div className="text-sm text-muted-foreground">{quizFeedback}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
};

const Metric = ({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) => (
  <Card className="dashboard-card-effect">
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-medium flex items-center gap-2">
        {icon}
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
    </CardContent>
  </Card>
);
