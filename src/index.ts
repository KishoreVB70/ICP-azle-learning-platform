// cannister code goes here
import { v4 as uuidv4 } from 'uuid';
import { Server, StableBTreeMap, ic } from 'azle';
import express from 'express';


class Course {
   id: string;
   creator_name: string;
//    creator_address: string; // Store the principal
   title: string;
   content: string;
   attachmentURL: string;
   category: string;
   keyword: string;
   contact: string;
   createdAt: Date;
   updatedAt: Date | null
}

const courseStorage = StableBTreeMap<string, Course>(0);

export default Server(() => {
   const app = express();
   app.use(express.json());

   app.post("/courses", (req, res) => {
      const course: Course =  {id: uuidv4(), createdAt: getCurrentDate(), ...req.body};
      courseStorage.insert(course.id, course);
      res.json(course);
   });

   app.get("/courses", (req, res) => {
      res.json(courseStorage.values());
   });

   app.get("/courses/:id", (req, res) => {
      const courseId = req.params.id;
      const courseOpt = courseStorage.get(courseId);
      if ("None" in courseOpt) {
         res.status(404).send(`the course with id=${courseId} not found`);
      } else {
         res.json(courseOpt.Some);
      }
   });

   app.put("/courses/:id", (req, res) => {
      const courseId = req.params.id;
      const courseOpt = courseStorage.get(courseId);
      if ("None" in courseOpt) {
         res.status(400).send(`couldn't update a course with id=${courseId}. course not found`);
      } else {
         const course = courseOpt.Some;
         const updatedMessage = { ...course, ...req.body, updatedAt: getCurrentDate()};
         courseStorage.insert(course.id, updatedMessage);
         res.json(updatedMessage);
      }
   });

   app.delete("/courses/:id", (req, res) => {
      const courseId = req.params.id;
      const deletedMessage = courseStorage.remove(courseId);
      if ("None" in deletedMessage) {
         res.status(400).send(`couldn't delete a course with id=${courseId}. course not found`);
      } else {
         res.json(deletedMessage.Some);
      }
   });

   return app.listen();
});

function getCurrentDate() {
   const timestamp = new Number(ic.time());
   return new Date(timestamp.valueOf() / 1000_000);
}

function filterCourses_OR(payload) {
    if (!payload.keyword && !payload.category && !payload.creatorAddress) {
        return {
          error: "Filter payload is empty; at least one filter criterion must be provided",
        };
    }
    const courses: Course[] = [];
    courseStorage.forEach((course) => {
        let matches = false;
        if (payload.keyword) {
          matches = course.keyword === payload.keyword;
        }
        if (payload.category) {
          matches = matches || course.category === payload.category;
        }
        if (payload.creatorAddress) {
          matches = matches || course.creatorAddress === payload.creatorAddress;
        }
        if (matches) {
          courses.push(course);
        }
      });
    
      if (courses.length === 0) {
        return {
          error: "Couldn't find a course with provided inputs",
        };
      }
    
      return { result: courses };
}