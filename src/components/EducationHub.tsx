import { useMemo, useState } from "react";
import { Play, BookOpen, Award, Clock, Users, Youtube, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { loadAppData, updateAppData } from "@/utils/appData";
import { useToast } from "@/hooks/use-toast";

const courseCatalog = [
  {
    id: 1,
    title: "Legal Document Literacy",
    description: "Learn to read and understand common legal documents like contracts, leases, and terms of service.",
    duration: "45 min",
    lessons: 8,
    level: "Beginner",
    students: 1240,
  },
  {
    id: 2,
    title: "Spotting Misinformation",
    description: "Develop skills to identify fake news, misleading claims, and unreliable sources in digital media.",
    duration: "60 min",
    lessons: 12,
    level: "Intermediate",
    students: 892,
  },
  {
    id: 3,
    title: "Digital Privacy Rights",
    description: "Understand your privacy rights and how to protect your personal data online.",
    duration: "30 min",
    lessons: 6,
    level: "Beginner",
    students: 2156,
  },
];

const quickTips = [
  {
    title: "Red Flags in Contracts",
    description: "Watch out for vague language, unlimited liability clauses, and unreasonable termination terms.",
    readTime: "3 min read",
  },
  {
    title: "Fact-Checking Basics",
    description: "Always verify claims with multiple credible sources before sharing information.",
    readTime: "2 min read",
  },
  {
    title: "Understanding Fine Print",
    description: "Key areas to focus on when reviewing terms and conditions or service agreements.",
    readTime: "4 min read",
  },
];

const youtubeChannels = [
  { name: "Code With Harry", url: "https://www.youtube.com/@CodeWithHarry" },
  { name: "CodeHelp by Babbar", url: "https://www.youtube.com/@CodeHelpbyBabbar" },
  { name: "Ezsnippet", url: "https://www.youtube.com/@ezsnippet" },
];

export const EducationHub = () => {
  const { toast } = useToast();
  const [store, setStore] = useState(() => loadAppData());
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const courses = useMemo(() => {
    return courseCatalog.map((course) => {
      const progressRecord = store.courses.find((c) => c.id === course.id);
      return {
        ...course,
        progress: progressRecord?.progress ?? 0,
      };
    });
  }, [store]);

  const watchlist = useMemo(() => courses.filter((c) => c.progress > 0 && c.progress < 100), [courses]);

  const updateProgress = (courseId: number, nextProgress: number) => {
    const next = updateAppData((current) => ({
      ...current,
      courses: current.courses.map((c) =>
        c.id === courseId
          ? {
              ...c,
              progress: Math.max(0, Math.min(100, nextProgress)),
              startedAt: c.startedAt ?? Date.now(),
              completedAt: nextProgress >= 100 ? Date.now() : undefined,
            }
          : c
      ),
    }));

    setStore(next);
  };

  const startCourse = (courseId: number) => {
    setSelectedCourseId(courseId);
    setIsDialogOpen(true);
  };

  const continueCourse = (courseId: number) => {
    const current = courses.find((c) => c.id === courseId)?.progress ?? 0;
    const next = Math.min(100, current + 25);
    updateProgress(courseId, next);
    toast({
      title: next >= 100 ? 'Course Completed' : 'Progress Updated',
      description: next >= 100 ? 'Great work. You completed this course.' : `Progress saved at ${next}%.`,
    });
  };

  const handleChannelClick = () => {
    if (selectedCourseId !== null) {
      const current = courses.find((c) => c.id === selectedCourseId)?.progress ?? 0;
      updateProgress(selectedCourseId, Math.max(10, current));
      toast({
        title: 'Course Started',
        description: 'Added to your watchlist with saved progress.',
      });
    }
    setIsDialogOpen(false);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2">Education Hub</h2>
        <p className="text-muted-foreground">Build legal literacy and critical-thinking skills with trackable progress.</p>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Featured Courses</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Card key={course.id} className="dashboard-card-effect flex flex-col">
              <CardHeader>
                <div className="flex justify-between items-start mb-2">
                  <Badge variant="outline">{course.level}</Badge>
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Users className="h-4 w-4 mr-1" />
                    {course.students}
                  </div>
                </div>
                <CardTitle className="text-lg">{course.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
                <p className="text-sm text-muted-foreground">{course.description}</p>

                <div className="flex justify-between text-sm text-muted-foreground">
                  <div className="flex items-center">
                    <Clock className="h-4 w-4 mr-1" />
                    {course.duration}
                  </div>
                  <div className="flex items-center">
                    <BookOpen className="h-4 w-4 mr-1" />
                    {course.lessons} lessons
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progress</span>
                    <span>{course.progress}%</span>
                  </div>
                  <Progress value={course.progress} />
                </div>

                {course.progress >= 100 ? (
                  <Button className="w-full" variant="outline" disabled>
                    <Award className="h-4 w-4 mr-2" />
                    Completed
                  </Button>
                ) : course.progress > 0 ? (
                  <Button className="w-full" variant="outline" onClick={() => continueCourse(course.id)}>
                    Continue Learning
                  </Button>
                ) : (
                  <Button className="w-full" onClick={() => startCourse(course.id)}>
                    <Play className="h-4 w-4 mr-2" />
                    Start Course
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {watchlist.length > 0 ? (
        <div>
          <h3 className="text-lg font-semibold mb-4">My Watchlist</h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {watchlist.map((course) => (
              <Card key={course.id} className="dashboard-card-effect">
                <CardHeader>
                  <CardTitle className="text-lg">{course.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">Progress: {course.progress}%</p>
                  <Button className="w-full" variant="outline" onClick={() => continueCourse(course.id)}>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark Next Lesson Complete
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="text-lg font-semibold mb-4">Quick Tips</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {quickTips.map((tip, index) => (
            <Card key={index} className="dashboard-card-effect">
              <CardContent className="p-4">
                <h4 className="font-medium mb-2">{tip.title}</h4>
                <p className="text-sm text-muted-foreground mb-3">{tip.description}</p>
                <div className="text-xs text-muted-foreground">{tip.readTime}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a Channel</DialogTitle>
            <DialogDescription>Select a source to begin. Progress will be tracked in your watchlist.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col space-y-3 pt-4">
            {youtubeChannels.map((channel) => (
              <Button asChild key={channel.name} variant="outline" className="justify-start">
                <a href={channel.url} target="_blank" rel="noopener noreferrer" onClick={handleChannelClick}>
                  <Youtube className="h-5 w-5 mr-3 text-red-500" />
                  {channel.name}
                </a>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
