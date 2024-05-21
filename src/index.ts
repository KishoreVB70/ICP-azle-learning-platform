// cannister code goes here
import { v4 as uuidv4 } from 'uuid';
import { Server, StableBTreeMap, ic } from 'azle';
import express from 'express';


class Course {
   id: string;
   creatorName: string;
   creatorAddress: string; // Store the principal
   title: string;
   content: string;
   attachmentURL: string;
   category: string;
   keyword: string;
   contact: string;
   createdAt: Date;
   updatedAt: Date | null
}

class FilterPayload {
  creatorName?: string;
  category?: string;
  keyword?: string;
}

const courseStorage = StableBTreeMap<string, Course>(0);
let admin: string;
let moderators: string[];

export default Server(() => {
   const app = express();
   app.use(express.json());

   app.post("/courses", (req, res) => {
      const course: Course =  {
        id: uuidv4(), createdAt: getCurrentDate(),
        creatorAddress: ic.caller().toString(), ...req.body
      };
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

   app.put("/admin/:address", (req, res) => {
      const address: string = req.params.address;
      setAdmin(address);
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
      const result = delete_course(courseId);
      if (result == typeof(String)) {
         res.status(400).send(`couldn't delete a course with id=${courseId}. course not found`);
      } else {
         res.json(result);
      }
   });

   return app.listen();
});

function setAdmin(address: string): string {
  if(admin) {
    let caller = ic.caller().toString();
    if (caller == admin) {
      admin = address;
      return admin;
    } 
    return "You are not authorized to change the admin";
  }

  admin = address;
  return admin;
}

function addModerator(address: string): string {
  let caller = ic.caller().toString();

  if(caller != admin ) {
    return "not authorized";
  }

  if (moderators.length == 5) {
    return "maximum number of moderators added";
  }

  if(address in moderators) {
    return "moderator already added";
  }

  moderators.push(address);
  return address;
}

function getCurrentDate() {
   const timestamp = new Number(ic.time());
   return new Date(timestamp.valueOf() / 1000_000);
}

function filterCourses_OR(payload: FilterPayload): Course[] | string {
  if (!payload.keyword && !payload.category && !payload.creatorName) {
      return "Filter payload is empty; at least one filter criterion must be provided";
  }

  // Create an empty array
  const courses: Course[] = [];

  // Returns array of tuple values of key and the value
  let items = courseStorage.items();

  // Using for of loop to iterate through the array
  // Destructuring the two entries in each tuple
  for(const [key, course] of items) {
    let matches = false;
    if (payload.keyword) {
      matches = course.keyword == payload.keyword;
    }
    if (payload.category) {
      matches = matches || course.category == payload.category;
    }
    if (payload.creatorName) {
      matches = matches || course.creatorName == payload.creatorName;
    }
    if (matches) {
      courses.push(course);
    }
  }

  if (courses.length === 0) {
    return "not found";
  }
    return courses;
}

function filterCourses_And(payload: FilterPayload): Course[] | string {
  // Add a separate function to check if payload is empty
  if (!payload.keyword && !payload.category && !payload.creatorName) {
    return "Filter payload is empty; at least one filter criterion must be provided";
  }
  
  const courses: Course[] = [];
  
  // Returns array of tuple values of key and the value
  let items = courseStorage.items();

  // Using for of loop to iterate through the array
  // Destructuring the two entries in each tuple
  for(const[key, course] of items) {
    let matches = true;
    if (payload.keyword) {
      matches = matches && course.keyword == payload.keyword;
    }
    if (payload.category) {
      matches = matches && course.category == payload.category;
    }
    if (payload.creatorName) {
      matches = matches && course.creatorName == payload.creatorName;
    }
    if (matches) {
      courses.push(course);
    }
  }

  if (courses.length === 0) {
    return "No courses";
  }

  return courses;
}

// Either the course creator or the admin or a moderator can delete a course
function delete_course(id: string): Course | string {
  let caller = ic.caller.toString();
  const courseOpt = courseStorage.get(id);
  if ("None" in courseOpt) {
    return `Course with id=${id} not found`;
 } else {
    const course = courseOpt.Some;
    if (caller == admin || caller ==  course.creatorAddress) {
      courseStorage.remove(id);
      return course;
    } else {
      return `you are not authorized to delete course with id=${id}`;
    }
 }
}